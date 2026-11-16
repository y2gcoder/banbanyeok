/**
 * 추적 함수의 본체. 의존성(설정, PostHog 로더, 브라우저 판단)을 받아 만들어 테스트에서 가짜로 바꿀 수 있다.
 *
 * - 설정(키)이 없거나, **이용자가 통계에 동의하지 않았거나**, 브라우저가 추적을 거부하면 **아무것도 하지 않는다**:
 *   PostHog 코드를 내려받지도, 초기화하지도 않고 요청도 없다(이벤트는 대기열에도 쌓지 않고 버린다).
 * - 동의를 철회하면(`revoke`) 즉시 PostHog를 끄고(opt-out) 이 기기의 통계 식별자를 지운다.
 * - PostHog는 첫 이벤트를 보낼 때 그때 불러온다(동적 import). 그 전에 쌓인 이벤트는 대기열에 두었다가 보낸다.
 * - 속성은 계약(events.gen.ts)으로 검증한다. 어기면 보내지 않는다(테스트에서는 던진다).
 */
import type { PostHogConfig } from "posthog-js";
import type { AnalyticsConfig } from "./config";
import type { CommonProperties, EventName, EventProperties } from "./events.gen";
import { AnalyticsContractError, buildEventProperties } from "./properties";
import { type CaptureContext, redactCapture } from "./redact";

/** 쓰는 PostHog 메서드만(테스트 가짜가 구현하기 쉽게). */
export type PostHogClient = {
  init(token: string, config: Partial<PostHogConfig>): unknown;
  set_config(config: Partial<PostHogConfig>): unknown;
  capture(event: string, properties?: Record<string, unknown>): unknown;
  opt_in_capturing(options?: { captureEventName?: string | null | false }): unknown;
  opt_out_capturing(): unknown;
  reset(resetDeviceId?: boolean): unknown;
};

export type TrackerDeps = {
  config: AnalyticsConfig | null;
  appVersion: string;
  /** 추적 거부 신호(DNT·GPC)가 있으면 true. */
  declined: () => boolean;
  /** 이용자가 통계에 동의했으면 true. 선택하지 않았거나 거부했으면 false. */
  consented: () => boolean;
  loadPostHog: () => Promise<PostHogClient>;
  /** 철회할 때 이 기기에 저장된 통계 식별자를 지운다. */
  clearStorage: () => void;
  /** PostHog를 초기화한 직후(식별자가 생긴 뒤)에 알린다. 화면이 식별자를 다시 읽는 데 쓴다. */
  onReady?: () => void;
  /** 오류·속도 이벤트에서 가릴 이 기기의 방 ID·토큰(redact.ts). 없으면 주소 규칙만 쓴다. */
  secrets?: () => readonly string[];
};

const MAX_QUEUE = 50;

/**
 * PostHog 초기화 옵션. 개인정보 최소화 원칙(docs/setup/p7-notes.md)을 한 곳에 모았다.
 * 켜는 자동 수집은 오류 추적(`$exception`)과 웹 바이탈(`$web_vitals`) 둘뿐이고(W4, contracts/events.json `sdkEvents`), 둘 다
 * before_send([redactCapture])가 메시지·스택·주소를 가린 뒤에 나간다. 그 밖의 기능(클릭·페이지뷰 자동 수집, 세션 녹화, 콘솔 로그,
 * 네트워크 타이밍, 설문, 플래그)은 모두 끈다. 콘솔 로그와 네트워크 타이밍에는 주소·방 ID가 들어갈 수 있어, 켜려면 처리방침의 통계
 * 항목과 동의 문구(consent-text.ts)를 먼저 고쳐야 한다.
 */
export function posthogOptions(config: AnalyticsConfig, context?: CaptureContext): Partial<PostHogConfig> {
  return {
    api_host: config.host,
    // 자동 수집 전부 끔: 클릭·입력창 텍스트·페이지뷰(URL 쿼리에 출발역이 있다)를 모으지 않는다.
    autocapture: false,
    rageclick: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    // 처리하지 못한 오류만(window.onerror·unhandledrejection). 콘솔 오류는 보내지 않는다. 확장 프로그램·브라우저가 넣은 스크립트의 오류는 SDK가 버린다.
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    // 웹 바이탈(LCP·CLS·FCP·INP 수치)만. 원인 요소(attribution: 요소 선택자·리소스 주소)는 보내지 않고, 네트워크 타이밍(녹화용)은 끈다.
    capture_performance: { web_vitals: true, web_vitals_attribution: false, network_timing: false },
    // 콘솔 출력을 로그로 보내는 기능은 끈다(메시지에 주소·방 ID가 들어갈 수 있다).
    logs: { captureConsoleLogs: false },
    // 세션 녹화·설문·실험 등 부가 기능과 외부 스크립트 로딩 끔.
    disable_session_recording: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    disable_web_experiments: true,
    disable_external_dependency_loading: true,
    // 시작할 때 /flags 요청(원격 설정·기능 플래그)을 하지 않는다. 위 기능은 어차피 전부 끄고 쓴다.
    advanced_disable_flags: true,
    // 익명 distinct_id로 시작한다. identify를 부르기 전에는 사람 프로필을 만들지 않는다.
    person_profiles: "identified_only",
    // 쿠키 없이 localStorage에만 익명 ID를 둔다. 리퍼러는 저장하지 않는다.
    persistence: "localStorage",
    save_referrer: false,
    respect_dnt: true,
    // SDK가 자동으로 붙이는 속성 중 가장 식별력이 큰 원문 사용자 에이전트는 보내지 않는다($browser·$os 같은 분류는 남는다).
    property_denylist: ["$raw_user_agent"],
    before_send: (result) => redactCapture(result, context),
  };
}

type Queued = { name: string; properties: Record<string, unknown> };

export type Tracker = {
  track<N extends EventName>(name: N, properties: EventProperties[N]): void;
  /** 결과 데이터 버전(manifest dataVersion). 알게 된 뒤의 모든 이벤트에 공통 속성으로 붙는다. */
  setDataVersion(version: string): void;
  /** 분석이 켜져 있는지(키가 있고, 동의했고, 추적 거부가 없음). */
  enabled(): boolean;
  /**
   * 켜져 있으면 PostHog를 미리 불러와 오류 추적·웹 바이탈을 시작한다(이벤트가 없는 페이지의 오류도 잡도록). 꺼져 있으면(동의 전·거부·
   * 추적 거부) 아무것도 하지 않는다: 불러오지도 않고 오류 처리기도 붙지 않는다.
   */
  start(): void;
  /** 동의 철회: 대기 중인 이벤트를 버리고, PostHog를 끄고, 저장된 식별자를 지운다. 이후 동의하면 새로 시작한다. */
  revoke(): void;
};

/** 계약 위반은 테스트에서는 던지고(실패), 개발 중에는 콘솔에 알리고, 운영에서는 조용히 버린다. */
function reportViolation(error: AnalyticsContractError): void {
  if (process.env.NODE_ENV === "test") throw error;
  if (process.env.NODE_ENV !== "production") console.error(error.message);
}

export function createTracker(deps: TrackerDeps): Tracker {
  let dataVersion: string | undefined;
  let client: PostHogClient | undefined;
  let loading: Promise<void> | undefined;
  let failed = false;
  // 철회·재동의 사이에 늦게 끝난 불러오기가 초기화하지 않도록 세대를 센다.
  let generation = 0;
  const queue: Queued[] = [];
  const common = (): CommonProperties => ({
    platform: "web",
    app_version: deps.appVersion,
    ...(dataVersion ? { data_version: dataVersion } : {}),
  });

  const enabled = () => deps.config !== null && !failed && !deps.declined() && deps.consented();

  const flush = () => {
    if (!client) return;
    for (const item of queue.splice(0)) client.capture(item.name, item.properties);
  };

  const ensureLoaded = () => {
    const config = deps.config;
    if (!config || loading) return;
    const mine = generation;
    loading = deps
      .loadPostHog()
      .then((posthog) => {
        if (mine !== generation || !enabled()) return; // 그 사이 철회됐다.
        const options = posthogOptions(config, {
          secrets: deps.secrets ?? (() => []),
          common,
          // 철회한 뒤에는(세대가 바뀜) SDK에 남은 처리기가 무엇을 만들어도 보내지 않는다.
          active: () => mine === generation && enabled(),
        });
        posthog.init(config.key, options);
        // 철회 뒤 다시 동의하면 같은 SDK 객체라 init이 설정을 다시 넣지 않는다. 철회 때 끈 기능·저장을 여기서 되돌린다.
        posthog.set_config(options);
        // 이전에 철회해 PostHog가 옵트아웃 표시를 남겼을 수 있다: 이번에는 동의했으므로 풀어 준다(옵트인 이벤트는 보내지 않는다).
        posthog.opt_in_capturing({ captureEventName: false });
        client = posthog;
        flush();
        deps.onReady?.();
      })
      .catch(() => {
        // 광고 차단기 등으로 불러오지 못해도 화면은 영향이 없다. 이 페이지에서는 더 시도하지 않는다.
        failed = true;
        queue.length = 0;
      });
  };

  return {
    enabled,
    start() {
      if (enabled()) ensureLoaded();
    },
    setDataVersion(version) {
      dataVersion = version;
    },
    revoke() {
      generation += 1;
      queue.length = 0;
      if (client) {
        // 오류 처리기를 떼고 웹 바이탈을 끄고 저장을 멈춘 뒤 옵트아웃한다. 웹 바이탈 관찰자는 SDK가 떼지 못하므로, 이후 페이지를 떠날 때
        // 남은 수치를 비우더라도 저장소에 식별자를 다시 쓰거나 보내지 않게 한다(before_send도 막는다).
        client.set_config({ capture_exceptions: false, capture_performance: false, disable_persistence: true });
        client.opt_out_capturing();
        client.reset();
      }
      client = undefined;
      loading = undefined;
      failed = false;
      deps.clearStorage();
    },
    track(name, properties) {
      let built: Record<string, unknown>;
      try {
        built = buildEventProperties(name, properties, common());
      } catch (error) {
        if (error instanceof AnalyticsContractError) return reportViolation(error);
        throw error;
      }
      if (!enabled()) return;
      if (client) client.capture(name, built);
      else if (queue.length < MAX_QUEUE) {
        queue.push({ name, properties: built });
        ensureLoaded();
      }
    },
  };
}
