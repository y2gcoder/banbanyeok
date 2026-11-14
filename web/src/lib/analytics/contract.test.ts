import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import { buildEventsModule, type EventsDocument, privacyViolations } from "../../../scripts/analytics-events.ts";
import {
  COMMON_PROPERTY_SPECS,
  EVENT_SPECS,
  type EventName,
  type EventProperties,
  FORBIDDEN_NAME_FRAGMENTS,
  FORBIDDEN_PROPERTY_NAMES,
} from "./events.gen";
import { AnalyticsContractError, buildEventProperties, isForbiddenPropertyName, propertyProblems } from "./properties";

const doc = JSON.parse(
  readFileSync(new URL("../../../../contracts/events.json", import.meta.url), "utf8"),
) as EventsDocument;

const common = { platform: "web", app_version: "test" } as const;

const clone = (): EventsDocument => structuredClone(doc);

describe("contracts/events.json 개인정보 규칙", () => {
  it("어떤 이벤트·공통 속성에도 금지된 이름이 없다", () => {
    expect(privacyViolations(doc)).toEqual([]);
  });

  it("금지된 속성 이름을 넣으면 위반으로 잡고 생성이 실패한다", () => {
    const bad = clone();
    bad.events[0]?.properties.push({ name: "origin_code", type: "string", required: false });
    expect(privacyViolations(bad)).toEqual([
      "input_completed.origin_code: 금지된 속성 이름",
      expect.stringContaining("origin"),
    ]);
    expect(() => buildEventsModule(bad)).toThrow(/origin_code/);
  });

  it("금지된 이름 조각이 들어간 속성(예: departure_origin_name, guest_token)도 잡는다", () => {
    for (const name of ["departure_origin_name", "guest_token", "my_nickname_len", "x_room_id_hash"]) {
      const bad = clone();
      bad.commonProperties.push({ name, type: "string", required: false });
      expect(privacyViolations(bad), name).not.toEqual([]);
    }
  });

  it("만날 역 코드(top1_station_code, meeting_station_code)는 장소라서 허용한다", () => {
    expect(isForbiddenPropertyName("top1_station_code")).toBe(false);
    expect(isForbiddenPropertyName("meeting_station_code")).toBe(false);
  });

  it("생성 파일의 금지 목록이 계약과 같다", () => {
    expect([...FORBIDDEN_PROPERTY_NAMES]).toEqual(doc.privacy.forbiddenPropertyNames);
    expect([...FORBIDDEN_NAME_FRAGMENTS]).toEqual(doc.privacy.forbiddenNameFragments);
  });

  it("생성 파일의 이벤트·속성이 계약(서버 전용 제외)과 같다", () => {
    const clientEvents = doc.events.filter((event) => event.source !== "server");
    expect(Object.keys(EVENT_SPECS).sort()).toEqual(clientEvents.map((event) => event.name).sort());
    for (const event of clientEvents) {
      const generated = EVENT_SPECS[event.name as EventName] as Record<string, { required: boolean }>;
      expect(Object.keys(generated).sort(), event.name).toEqual(event.properties.map((p) => p.name).sort());
      for (const property of event.properties) {
        expect(generated[property.name]?.required, `${event.name}.${property.name}`).toBe(property.required);
      }
    }
    expect(Object.keys(COMMON_PROPERTY_SPECS).sort()).toEqual(doc.commonProperties.map((p) => p.name).sort());
  });

  it("웹이 쓰는 모든 이벤트·속성의 이름이 금지 규칙을 통과한다", () => {
    for (const [event, specs] of Object.entries(EVENT_SPECS)) {
      for (const name of Object.keys(specs)) expect(isForbiddenPropertyName(name), `${event}.${name}`).toBe(false);
    }
  });
});

describe("속성 검증(실행 시)", () => {
  const valid = { participant_count: 2, has_custom_name: false, mode: "fair", input_ms: 1200 } as const;

  it("계약대로면 통과하고 공통 속성이 붙는다", () => {
    expect(buildEventProperties("input_completed", valid, common)).toEqual({ ...valid, ...common });
  });

  it("출발역·별칭 같은 금지 속성이 섞이면 던진다(테스트가 실패한다)", () => {
    // @ts-expect-error 타입도 막는다: 계약에 없는 속성
    expect(() => buildEventProperties("input_completed", { ...valid, origin_codes: "ABC.DEF" }, common)).toThrow(
      AnalyticsContractError,
    );
    const problems = propertyProblems(EVENT_SPECS.input_completed, {
      ...valid,
      origin_codes: "ABC.DEF",
      nicknames: "민지",
    });
    expect(problems).toEqual([
      expect.stringContaining("origin_codes: 금지"),
      expect.stringContaining("nicknames: 금지"),
    ]);
  });

  it("계약에 없는 일반 속성과 잘못된 값도 막는다", () => {
    expect(propertyProblems(EVENT_SPECS.input_completed, { ...valid, extra: 1 })).toEqual([
      expect.stringContaining("extra: contracts/events.json에 없는 속성"),
    ]);
    expect(propertyProblems(EVENT_SPECS.input_completed, { ...valid, participant_count: 9 })).toEqual([
      expect.stringContaining("participant_count: 4 이하"),
    ]);
    expect(propertyProblems(EVENT_SPECS.input_completed, { ...valid, mode: "slow" })).toEqual([
      expect.stringContaining("mode: 허용 값이 아닙니다"),
    ]);
    expect(propertyProblems(EVENT_SPECS.input_completed, { has_custom_name: true })).toHaveLength(3);
    expect(propertyProblems(EVENT_SPECS.station_chosen, { meeting_station_code: "x".repeat(65) })).toContainEqual(
      expect.stringContaining("meeting_station_code: 64자 이하"),
    );
  });

  it("타입: 이벤트별 속성이 계약에서 나온다", () => {
    expectTypeOf<EventProperties["station_chosen"]>().toHaveProperty("meeting_station_code");
    expectTypeOf<EventProperties["input_completed"]>().not.toHaveProperty("origin_codes");
    expectTypeOf<EventProperties["input_completed"]["mode"]>().toEqualTypeOf<"fair" | "fast" | "favor">();
    // 서버 전용 이벤트는 웹이 보낼 수 없다.
    expectTypeOf<"room_created">().not.toExtend<EventName>();
  });
});
