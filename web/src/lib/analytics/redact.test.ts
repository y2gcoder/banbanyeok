import type { CaptureResult } from "posthog-js";
import { describe, expect, it } from "vitest";
import stationIndex from "../stations/index.gen.json";
import { isCampaignProperty, MESSAGE_WORDS, maskMessage, redactCapture, redactText, redactUrl } from "./redact";

const SHARE_URL = "https://banbanyeok.example/s?o=ABC.DEF&n=%EB%AF%BC%EC%A7%80&m=favor.1#top";

function capture(properties: Record<string, unknown>, extra: Partial<CaptureResult> = {}): CaptureResult {
  return { uuid: "u", event: "result_viewed", properties, ...extra } as CaptureResult;
}

describe("redactUrl", () => {
  it("공유 링크의 쿼리와 해시를 뗀다", () => {
    expect(redactUrl(SHARE_URL)).toBe("https://banbanyeok.example/s");
    expect(redactUrl("https://banbanyeok.example/meet?x=1")).toBe("https://banbanyeok.example/meet");
  });

  it("조합 페이지 경로의 역 코드를 가린다(주소·경로 모두)", () => {
    expect(redactUrl("https://banbanyeok.example/meet/e87-k3a?x=1")).toBe("https://banbanyeok.example/meet/[pair]");
    expect(redactUrl("/meet/e87-k3a")).toBe("/meet/[pair]");
    expect(redactUrl("/meet")).toBe("/meet");
  });

  it("방 경로의 방 ID를 가린다(방 만들기 경로는 그대로)", () => {
    expect(redactUrl("https://banbanyeok.example/r/qt7yvmsht3?x=1#top")).toBe("https://banbanyeok.example/r/[room]");
    expect(redactUrl("/r/QT7YVMSHT3")).toBe("/r/[room]");
    expect(redactUrl("https://banbanyeok.example/r/new")).toBe("https://banbanyeok.example/r/new");
    expect(redactUrl("/r/qt7yvmsht3/")).toBe("/r/[room]/");
    // 10자가 아니면 방 ID가 아니다(다른 경로를 건드리지 않는다).
    expect(redactUrl("/r/abc")).toBe("/r/abc");
  });

  it("방 API 경로(/rooms/<방 ID>)의 방 ID도 가린다", () => {
    expect(redactUrl("https://banbanyeok.example/api/v1/rooms/qt7yvmsht3/result?mode=fair")).toBe(
      "https://banbanyeok.example/api/v1/rooms/[room]/result",
    );
    expect(redactUrl("/api/v1/rooms")).toBe("/api/v1/rooms");
  });

  it("주소가 아닌 값은 문자열만 자른다", () => {
    expect(redactUrl("$direct")).toBe("$direct");
    expect(redactUrl("/s?o=ABC")).toBe("/s");
  });
});

describe("redactCapture(before_send)", () => {
  it("URL류 자동 속성에서 쿼리를 지우고 다른 속성은 건드리지 않는다", () => {
    const result = redactCapture(
      capture(
        {
          $current_url: SHARE_URL,
          $referrer: SHARE_URL,
          $initial_referrer: "https://www.google.com/search?q=%EA%B0%95%EB%82%A8",
          $session_entry_url: SHARE_URL,
          $pathname: "/meet/e87-k3a",
          $session_entry_pathname: "/s",
          participant_count: 2,
        },
        { $set_once: { $initial_current_url: SHARE_URL }, $set: { $current_url: SHARE_URL } },
      ),
    );
    expect(result?.properties).toMatchObject({
      $current_url: "https://banbanyeok.example/s",
      $referrer: "https://banbanyeok.example/s",
      $initial_referrer: "https://www.google.com/search",
      $session_entry_url: "https://banbanyeok.example/s",
      $pathname: "/meet/[pair]",
      $session_entry_pathname: "/s",
      participant_count: 2,
    });
    expect(result?.$set_once).toEqual({ $initial_current_url: "https://banbanyeok.example/s" });
    expect(result?.$set).toEqual({ $current_url: "https://banbanyeok.example/s" });
    expect(JSON.stringify(result)).not.toContain("ABC");
  });

  it("방 링크의 방 ID는 어떤 URL 속성에도 남지 않는다(현재·이전·진입 주소)", () => {
    const room = "https://banbanyeok.example/r/qt7yvmsht3";
    const result = redactCapture(
      capture(
        { $current_url: room, $referrer: room, $session_entry_url: room, $pathname: "/r/qt7yvmsht3" },
        { $set_once: { $initial_current_url: room } },
      ),
    );
    expect(JSON.stringify(result)).not.toMatch(/qt7yvmsht3/i);
    expect(result?.properties).toMatchObject({ $current_url: "https://banbanyeok.example/r/[room]" });
  });

  it("유입 태그(utm_*·클릭 ID·검색어)는 어느 판이든 속성째 지운다: 링크에 붙인 별명·역 코드가 나가지 않는다(#116 검토)", () => {
    const tags = {
      utm_term: "검토별명",
      utm_content: "k3a.ryf",
      utm_source: "kakao",
      gclid: "Cj0x",
      ph_keyword: "강남 민지",
    };
    const result = redactCapture(
      capture(
        {
          ...tags,
          $session_entry_utm_term: "검토별명",
          $session_entry_utm_content: "k3a.ryf",
          $session_entry_ph_keyword: "강남 민지",
          $fbc: "fb.1.x",
          $search_engine: "google",
          participant_count: 2,
        },
        { $set_once: { $initial_utm_term: "검토별명", $initial_gclid: "Cj0x" }, $set: { utm_medium: "x" } },
      ),
    );
    expect(result?.properties).toEqual({ $search_engine: "google", participant_count: 2, $geoip_disable: true });
    expect(result?.$set_once).toEqual({});
    expect(result?.$set).toEqual({});
    expect(JSON.stringify(result)).not.toMatch(/검토별명|k3a|ryf|민지|Cj0x/);
  });

  it("isCampaignProperty: 접두(`$`, `$session_entry_`, `$initial_`)를 떼고 보며, 다른 SDK 속성은 건드리지 않는다", () => {
    for (const name of [
      "utm_new_thing",
      "$session_entry_gclid",
      "$initial_utm_campaign",
      "$fbp",
      "$initial_ph_keyword",
    ]) {
      expect(isCampaignProperty(name), name).toBe(true);
    }
    for (const name of [
      "$current_url",
      "$session_id",
      "$device_id",
      "$insert_id",
      "$search_engine",
      "$referring_domain",
    ]) {
      expect(isCampaignProperty(name), name).toBe(false);
    }
  });

  it("위치(GeoIP) 보강을 끈다", () => {
    expect(redactCapture(capture({}))?.properties).toMatchObject({ $geoip_disable: true });
  });

  it("null은 그대로 null", () => {
    expect(redactCapture(null)).toBeNull();
  });
});

const ROOM = "qt7yvmsht3";
const TOKEN = `${"tok".repeat(10)}${"A_b-".repeat(3)}z`; // 43자 base64url(토큰 모양). 실제 값처럼 보이지 않게 만든다
const STORED_TOKEN = "ptok-host-secret-value";
const PAGE = `https://banbanyeok.example/r/${ROOM}?o=ABC.DEF&n=%EB%AF%BC%EC%A7%80#x`;

describe("redactText(오류 메시지·스택 같은 자유 글)", () => {
  it("글 안의 주소: 쿼리·해시를 떼고 방 ID·역 조합을 가린다(스택 줄의 줄·칸 번호는 남긴다)", () => {
    expect(redactText(`at load (https://banbanyeok.example/r/${ROOM}:12:34)`)).toBe(
      "at load (https://banbanyeok.example/r/[room]:12:34)",
    );
    expect(redactText(`at load (${PAGE})`)).toBe("at load (https://banbanyeok.example/r/[room])");
    expect(redactText("fetch failed: https://banbanyeok.example/meet/e87-k3a?x=1")).toBe(
      "fetch failed: https://banbanyeok.example/meet/[pair]",
    );
    expect(redactText("GET /api/v1/rooms/qt7yvmsht3/result?mode=fair 500")).toBe("GET /api/v1/rooms/[room]/result 500");
    expect(redactText("https://banbanyeok.example/api/v1/rooms/QT7YVMSHT3/participants")).toBe(
      "https://banbanyeok.example/api/v1/rooms/[room]/participants",
    );
    // 10자가 아니면 방 ID가 아니다.
    expect(redactText("/api/v1/rooms/abc")).toBe("/api/v1/rooms/abc");
    expect(redactText("bad link /result?v=2&o=abc.def&n=민지")).toBe("bad link /result");
  });

  it("문장의 물음표·번호는 건드리지 않는다", () => {
    expect(redactText("Minified React error #418; why?")).toBe("Minified React error #418; why?");
  });

  it("Bearer 토큰과 토큰 모양 문자열(43자)을 가린다", () => {
    expect(redactText(`Authorization: Bearer ${STORED_TOKEN}`)).toBe("Authorization: Bearer [token]");
    expect(redactText(`token=${TOKEN} end`)).toBe("token=[token] end");
  });

  it("이 기기가 아는 방 ID·토큰은 어디에 있든 가린다(대소문자 무시, 8자 미만은 무시)", () => {
    expect(redactText(`room ${ROOM.toUpperCase()} / ${STORED_TOKEN}`, [ROOM, STORED_TOKEN, "abc"])).toBe(
      "room [redacted] / [redacted]",
    );
    expect(redactText("abc.def", ["abc"])).toBe("abc.def");
  });
});

describe("maskMessage(오류 메시지의 형식만)", () => {
  it("흔한 오류 문구는 그대로 둔다", () => {
    for (const message of [
      "Cannot read properties of null (reading 'length')",
      "Failed to fetch",
      "Load failed",
      "The operation was aborted.",
      "Maximum call stack size exceeded",
      "Unexpected end of JSON input",
    ]) {
      expect(maskMessage(message)).toBe(message);
    }
  });

  it("목록에 없는 낱말(한글·숫자·역 코드·따옴표 안의 값)은 `…`가 되고, 이어진 것은 하나로 합친다", () => {
    expect(maskMessage("검토별명 k3a.ryf 강남에서 실패")).toBe("…");
    expect(maskMessage(`Unexpected token '검', "검토별명" is not valid JSON`)).toBe(
      `Unexpected token '…', "…" is not valid JSON`,
    );
    expect(maskMessage("bad origin ryf for Tom")).toBe("… origin … for …");
    expect(maskMessage("Loading chunk 123 failed.")).toBe("Loading chunk … failed.");
  });

  it("가린 주소와 자리표시는 남긴다", () => {
    expect(maskMessage("room [redacted] failed at https://banbanyeok.example/result Bearer [token]")).toBe(
      "… [redacted] failed at https://banbanyeok.example/result … [token]",
    );
  });

  it("남기는 낱말 중 역 코드와 같은 것은 없다(역 목록과 대조)", () => {
    const codes = new Set(stationIndex.stations.map((station) => String(station[0]).toLowerCase()));
    expect(codes.size).toBeGreaterThan(100);
    expect([...MESSAGE_WORDS].filter((word) => codes.has(word))).toEqual([]);
  });
});

describe("redactCapture: SDK 자동 이벤트($exception·$web_vitals)", () => {
  const secrets = () => [ROOM, STORED_TOKEN];

  it("계약(sdkEvents)에 없는 $ 이벤트는 버린다", () => {
    for (const event of ["$pageview", "$pageleave", "$autocapture", "$snapshot", "$opt_in", "$identify"]) {
      expect(redactCapture({ uuid: "u", event, properties: {} } as CaptureResult), event).toBeNull();
    }
    expect(redactCapture(capture({}))).not.toBeNull(); // 우리 이벤트는 그대로 보낸다
  });

  it("$exception: 메시지·스택 파일 경로·함수·주소에서 방 ID·역 코드·이름·토큰이 남지 않는다", () => {
    const result = redactCapture(
      {
        uuid: "u",
        event: "$exception",
        properties: {
          $current_url: PAGE,
          $pathname: `/r/${ROOM}`,
          $exception_level: "error",
          $exception_types: ["Error"],
          $exception_values: [`load ${ROOM} failed at ${PAGE} with Bearer ${STORED_TOKEN} ${TOKEN}`],
          $exception_list: [
            {
              type: "Error",
              value: `load ${ROOM} failed at ${PAGE}`,
              mechanism: { handled: false, synthetic: false },
              stacktrace: {
                type: "raw",
                frames: [
                  {
                    filename: `${PAGE}`,
                    abs_path: `https://banbanyeok.example/_next/static/chunks/app.js?o=ABC.DEF`,
                    function: `room_${ROOM}`,
                    lineno: 1,
                    colno: 2,
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      } as unknown as CaptureResult,
      { secrets },
    );
    const text = JSON.stringify(result);
    for (const needle of [ROOM, STORED_TOKEN, TOKEN, "ABC", "DEF", "o=", "%EB%AF%BC", "민지"]) {
      expect(text, needle).not.toContain(needle);
    }
    expect(result?.properties).toMatchObject({
      $current_url: "https://banbanyeok.example/r/[room]",
      $exception_level: "error",
      $geoip_disable: true,
    });
    type Frames = { type: string; value: string; stacktrace: { frames: Record<string, unknown>[] } }[];
    const [first] = (result?.properties.$exception_list ?? []) as Frames;
    expect(first?.type).toBe("Error");
    expect(first?.value).toBe("load [redacted] failed at https://banbanyeok.example/r/[room]");
    const frame = first?.stacktrace.frames[0];
    expect(frame).toMatchObject({
      filename: "https://banbanyeok.example/r/[room]",
      abs_path: "https://banbanyeok.example/_next/static/chunks/app.js",
      lineno: 1,
      colno: 2,
    });
  });

  it("중첩 객체의 키에 든 방 ID·주소도 가린다", () => {
    const result = redactCapture(
      {
        uuid: "u",
        event: "$web_vitals",
        properties: { extra: [{ [`/r/${ROOM}?o=ABC`]: 1, [STORED_TOKEN]: "x" }] },
      } as unknown as CaptureResult,
      { secrets },
    );
    expect(JSON.stringify(result)).not.toMatch(/qt7yvmsht3|ABC|ptok-host/);
    expect(result?.properties.extra).toEqual([{ "/r/[room]": 1, "[redacted]": "x" }]);
  });

  it("$exception: 평문 메시지의 별명·역 코드는 형식만 남기고, 식별자가 아닌 종류는 Error로, 단계 기록은 버린다(#116 검토)", () => {
    const result = redactCapture(
      {
        uuid: "u",
        event: "$exception",
        properties: {
          $exception_message: "검토별명 k3a.ryf",
          $exception_type: "검토별명",
          $exception_values: ["검토별명 k3a.ryf"],
          $exception_types: ["TypeError"],
          $exception_steps: [{ $message: "검토별명" }],
          $exception_list: [{ type: "TypeError", value: "Cannot read properties of undefined (reading '검토별명')" }],
        },
      } as unknown as CaptureResult,
      { secrets },
    );
    expect(result?.properties).toMatchObject({
      $exception_message: "…",
      $exception_type: "Error",
      $exception_values: ["…"],
      $exception_types: ["TypeError"],
      $exception_list: [{ type: "TypeError", value: "Cannot read properties of undefined (reading '…')" }],
    });
    expect(result?.properties).not.toHaveProperty("$exception_steps");
    expect(JSON.stringify(result)).not.toMatch(/검토별명|k3a|ryf/);
  });

  it("공통 속성(platform·app_version)을 붙인다", () => {
    const result = redactCapture({ uuid: "u", event: "$web_vitals", properties: {} } as unknown as CaptureResult, {
      secrets,
      common: () => ({ platform: "web", app_version: "abc" }),
    });
    expect(result?.properties).toMatchObject({ platform: "web", app_version: "abc", $geoip_disable: true });
  });

  it("$web_vitals: 수치는 그대로, 수치마다 붙은 주소(중첩 객체)도 가린다", () => {
    const result = redactCapture(
      {
        uuid: "u",
        event: "$web_vitals",
        properties: {
          $current_url: PAGE,
          $web_vitals_LCP_value: 1234.5,
          $web_vitals_LCP_event: { name: "LCP", value: 1234.5, $current_url: PAGE, navigationURL: PAGE },
        },
      } as unknown as CaptureResult,
      { secrets },
    );
    expect(result?.properties).toMatchObject({
      $current_url: "https://banbanyeok.example/r/[room]",
      $web_vitals_LCP_value: 1234.5,
      $web_vitals_LCP_event: {
        name: "LCP",
        value: 1234.5,
        $current_url: "https://banbanyeok.example/r/[room]",
        navigationURL: "https://banbanyeok.example/r/[room]",
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/qt7yvmsht3|ABC|o=/);
  });
});
