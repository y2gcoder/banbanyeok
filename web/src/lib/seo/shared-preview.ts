/**
 * 공유 링크(`/s?...`)의 미리보기: 제목·설명(`generateMetadata`)과 이미지 데이터(`/s/og`)가 같은 문구를 쓰게 한 곳에서 만든다.
 * 제목은 제안하는 말투("{1위역}에서 볼까?"), 설명은 각자 시간("민수 34분 · 홍대입구 38분 · 공평하게 고름", product-ux 4.4).
 * 이름은 서버 짧은 이름(shortLabel)이다: 미리보기는 좁은 칸이라 "홍대입구에서 오는 분" 대신 "홍대입구"(V1).
 */
import { cache } from "react";
import { recommend } from "@/lib/api/client";
import type { Mode, RecommendResult } from "@/lib/api/types";
import { formatMinutes } from "@/lib/display/minutes";
import { encodeShareQuery, type ShareState } from "@/lib/link/codec";
import { type LastTrainView, lastTrainCardLine } from "@/lib/result/last-train";
import { mapMiddleSentence } from "@/lib/result/map-middle";
import { modeSentence } from "@/lib/result/mode-sentence";
import { type ResultView, toResultView } from "@/lib/result/view-model";
import { DEFAULT_SLOT, type TimeSlot } from "@/lib/when/time-slot";
import { ogSafeName } from "./og-coverage";
import { OG_TEXT, SHARED_OG_IMAGE_VERSION } from "./og-text";

/** 크롤러(카카오·슬랙 등)가 오래 기다려 주지 않는다. 서버가 깨는 중이면 기본 미리보기로 간다. */
const RECOMMEND_TIMEOUT_MS = 3000;

const SHARED_OG_PATH = "/s/og";

/** 평일 낮이 아닌 기준이면 "토요일 저녁 기준"(시간이 그 기준이라서). 평일 낮은 null이다(옛 링크와 같은 문구). */
export function basisText(view: ResultView): string | null {
  const basis = view.timeBasis as ResultView["timeBasis"] | undefined; // 구분을 모르는 옛 서버는 보내지 않는다
  return !basis || basis.timeSlot === DEFAULT_SLOT ? null : `${basis.label}${OG_TEXT.basisSuffix}`;
}

/** 설명·그림 기준 줄 뒤에 붙는 " · 토요일 저녁 기준". */
function basisSuffix(view: ResultView): string {
  const text = basisText(view);
  return text === null ? "" : ` ${OG_TEXT.middleDot} ${text}`;
}

function favorName(view: ResultView, state: ShareState): string | null {
  return state.favorIndex === null ? null : (view.people[state.favorIndex]?.shortName ?? null);
}

/** 공유 링크 그림(`SharedCard`)에 넘기는 값. */
export type SharedCardData = {
  stationName: string;
  /** 역 이름 아래 큰 줄. 없으면 "에서 볼까?"(방에서 정한 역은 "에서 만나요"). */
  suffix?: string;
  /**
   * 입력 순서. 이름은 서버 짧은 이름(shortLabel)을 글꼴에 있는 글자만으로 정리한 값(`ogSafeName`)이다. 출발역을 숨긴 사람은 서버가
   * "참가자 N"으로 주므로 숨긴 출발역은 그림에 나올 수 없다. `favored`는 "누구 쪽으로"에서 고른 사람. `minutes`가 null이면 그 역까지 갈 수 없다.
   */
  people: {
    name: string;
    minutes: number | null;
    favored: boolean;
    /**
     * 시간 아래의 작은 줄 "막차 00:03" / "늦어도 23:00"(#62). 시각을 모르면(확인 필요) 키가 없다. 출발역을 숨긴 사람에게는
     * 늘 없다(미리보기는 누가 보든 같은 그림이다).
     */
    lastTrain?: string;
  }[];
  /** "공평하게 고름" 같은 기준 한 마디(+ " · 토요일 밤 기준"). */
  modeLine: string;
  /** 왼쪽 아래 두 줄을 직접 정한다(방에서 정한 역: "민수가 정했어요" / "11월 21일 (토) 저녁"). 없으면 최장·차이·기준. */
  footer?: { main: string; sub: string };
};

export type SharedPreview = { title: string; description: string };

export function sharedPreview(view: ResultView, state: ShareState): SharedPreview | null {
  const top = view.candidates[0];
  if (!top) return null;
  const times = top.people.map((p) => `${p.shortName} ${formatMinutes(p.minutes)}`).join(" · ");
  const middle = mapMiddleSentence(view);
  return {
    title: `${top.stationName}${OG_TEXT.sharedSuffix}`,
    description: `${times} · ${modeSentence(view.mode, favorName(view, state))}${basisSuffix(view)}${middle ? ` ${OG_TEXT.middleDot} ${middle}` : ""}`,
  };
}

/** 그림에 넣는 막차 줄. 그 사람의 줄에 시각이 있고, 본인에게만 보이는 줄(출발역을 숨긴 본인)이 아닐 때만. */
function cardLastTrain(lastTrain: LastTrainView | null, index: number): string | null {
  const row = lastTrain?.rows.find((r) => r.index === index);
  if (!row || row.onlyMe || (row.state.kind !== "direct" && row.state.kind !== "margin")) return null;
  return lastTrainCardLine(row.state, OG_TEXT);
}

/**
 * 이미지에 그릴 값. 이름은 서버 짧은 이름이고, 글꼴에 없는 글자는 거른다(`ogSafeName`). 이모지만으로 된 별칭처럼 남는 글자가 없으면
 * 순번("참가자 N")으로 그린다(시점 표현 "나/친구1"은 쓰지 않는다).
 */
export function sharedCardData(view: ResultView, state: ShareState): SharedCardData | null {
  const top = view.candidates[0];
  if (!top) return null;
  const safe = (name: string, index: number) => ogSafeName(name, `참가자 ${index + 1}`);
  const favored = view.mode === "favor" ? state.favorIndex : null;
  return {
    stationName: top.stationName,
    people: top.people.map((p, index) => {
      const lastTrain = cardLastTrain(top.lastTrain, index);
      return {
        name: safe(p.shortName, index),
        minutes: p.minutes,
        favored: index === favored,
        ...(lastTrain ? { lastTrain } : {}),
      };
    }),
    modeLine:
      modeSentence(view.mode, favored === null ? null : safe(view.people[favored]?.shortName ?? "", favored)) +
      basisSuffix(view),
  };
}

/**
 * `og:image` 주소. 데이터 버전(`dv`)을 붙여, 새 데이터가 나오면 주소가 바뀌어 크롤러 캐시를 비켜 간다. 그림 디자인 버전(`iv`,
 * `SHARED_OG_IMAGE_VERSION`)도 붙여, 그림이 바뀌면 같은 결과도 새 주소가 된다(카카오는 그림을 주소별로 오래 캐시하고 지울 길이 없다).
 * 링크 자신의 버전 `v`(1·2)와 다른 값이다.
 */
export function sharedImagePath(state: ShareState, dataVersion: string): string {
  return `${SHARED_OG_PATH}?${encodeShareQuery(state)}&dv=${encodeURIComponent(dataVersion)}&iv=${SHARED_OG_IMAGE_VERSION}`;
}

/**
 * `cache`가 인자 값으로 같은 요청을 알아보게 별칭 목록은 JSON 문자열로 받는다. `signal`은 부른 쪽의 중단 신호(`/s/og`의 시간 예산)이며
 * 자체 제한 시간과 함께 건다. 신호가 다르면 다른 호출로 본다(페이지 메타데이터처럼 신호 없이 부르는 곳끼리만 한 번으로 묶인다).
 */
async function fetchResult(
  origins: string,
  mode: Mode,
  favorIndex: number | null,
  nicknamesJson: string,
  timeSlot: TimeSlot,
  slotDefaulted: boolean,
  signal: AbortSignal | undefined,
): Promise<RecommendResult | null> {
  try {
    const nicknames = JSON.parse(nicknamesJson) as ShareState["nicknames"];
    const timeout = AbortSignal.timeout(RECOMMEND_TIMEOUT_MS);
    return await recommend(
      // 옛 링크(v=1)는 구분을 고른 적이 없다: 결과 화면과 같이 구분 없이 요청한다(막차 시각이 미리보기에 실리지 않게).
      {
        origins: origins.split("."),
        mode,
        favorIndex,
        nicknames,
        timeSlot,
        ...(slotDefaulted ? { slotDefaulted } : {}),
      },
      signal ? AbortSignal.any([timeout, signal]) : timeout,
    );
  } catch {
    return null;
  }
}

const fetchResultOnce = cache(fetchResult);

/**
 * 결과를 받아 화면 값으로. 서버가 느리거나 실패하거나 `signal`로 중단되면 null(호출한 쪽이 기본 미리보기로 대체). 한 요청 안에서는 한 번만 부른다.
 * 링크의 구분과 다른 기준으로 계산된 결과(서버가 구분 행렬을 못 써 평일 낮으로 대신 계산)도 null이다: 메신저가 미리보기를 오래 캐시하므로
 * 틀린 기준의 제목·설명·그림을 남기지 않고 기본 미리보기(짧은 캐시)로 간다.
 */
export async function loadSharedView(state: ShareState, signal?: AbortSignal): Promise<ResultView | null> {
  const result = await fetchResultOnce(
    state.origins.join("."),
    state.mode,
    state.favorIndex,
    JSON.stringify(state.nicknames),
    state.timeSlot,
    state.slotDefaulted === true,
    signal,
  );
  if (!result) return null;
  const used = (result.timeBasis as RecommendResult["timeBasis"] | undefined)?.timeSlot ?? DEFAULT_SLOT;
  return used === state.timeSlot ? toResultView(result) : null;
}
