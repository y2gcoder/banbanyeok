/**
 * 계약 동기화 검사: 가짜 서버 응답과 웹이 보내는 요청 본문이 contracts/openapi.yaml 스키마를 지키는지 ajv로 확인한다.
 * (생성된 TS 타입이 계약과 같은지는 CI의 `pnpm check:contracts`가 재생성 후 diff로 본다.)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { mockRecommend } from "../../../mock/recommend";
import { loadMockData, problem, validateRecommend } from "../../../mock/server";
import { PROBLEM_DOCS, problemType } from "../problems/problems";
import { type CreateRoomForm, toCreateRoomRequest, toOutcomeAnswer, toParticipantInput } from "../room/input";
import { DEFAULT_REGION, searchStations, stationByCode } from "../stations";
import { recommendBody } from "./client";

type ResponseObject = { content?: Record<string, unknown> } & { $ref?: string };
type OperationResponses = { responses?: Record<string, ResponseObject> };
type OpenApi = {
  components: { schemas: Record<string, unknown>; responses?: Record<string, { content?: Record<string, unknown> }> };
  paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: unknown }> } }>>;
};

const doc = parse(readFileSync(resolve(import.meta.dirname, "../../../../contracts/openapi.yaml"), "utf8")) as OpenApi;
// OpenAPI 3.1 스키마는 JSON Schema 2020-12다. 참조 위치만 $defs로 옮겨 한 문서로 컴파일한다.
const rebased = (schema: unknown) =>
  JSON.parse(JSON.stringify(schema).replaceAll("#/components/schemas/", "contract#/$defs/"));

const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats.default(ajv);
ajv.addSchema({ $id: "contract", $defs: rebased(doc.components.schemas) });
const resultSchema = ajv.compile({ $ref: "contract#/$defs/Result" });
const errorSchema = ajv.compile({ $ref: "contract#/$defs/Problem" });
const requestSchema = ajv.compile(
  rebased(doc.paths["/recommend"]?.post?.requestBody?.content["application/json"]?.schema) as object,
);

const data = loadMockData();
// 한 계산에는 한 권역만 들어간다(ADR-0008). 권역을 켠 색인에서도 같은 권역의 출발역으로 사람을 고른다.
const supported = [...data.origins.keys()].filter((code) => stationByCode(code)?.region === DEFAULT_REGION);
let people: string[][] = [];

beforeAll(() => {
  const pick = (i: number) => supported[(i * 37) % supported.length] ?? "";
  people = [
    [pick(1), pick(2)],
    [pick(3), pick(4), pick(5)],
    [pick(6), pick(7), pick(8), pick(9)],
    [pick(1), pick(1)],
  ];
});

describe("가짜 서버가 계약을 지킨다", () => {
  it("모든 모드·인원의 /recommend 응답이 Result 스키마를 통과한다", () => {
    for (const origins of people) {
      for (const body of [
        { origins, mode: "fair" as const },
        { origins, mode: "fast" as const },
        ...origins.map((_, favorIndex) => ({ origins, mode: "favor" as const, favorIndex })),
      ]) {
        const result = mockRecommend(data, body);
        expect(resultSchema(result), JSON.stringify(resultSchema.errors)).toBe(true);
        expect(result.candidates.length).toBeGreaterThan(0);
        expect(result.candidates.map((c) => c.rank)).toEqual(result.candidates.map((_, i) => i + 1));
      }
    }
  });

  it("검사기가 실제로 어긋남을 잡는다(필수 필드 누락)", () => {
    const result = mockRecommend(data, { origins: people[0] ?? [], mode: "fair" });
    const [first] = result.candidates;
    if (!first) throw new Error("후보가 없다");
    const { reason: _reason, ...withoutReason } = first;
    expect(resultSchema({ ...result, candidates: [withoutReason] })).toBe(false);
  });

  it("잘못된 요청은 계약의 오류 모양으로 거부한다", () => {
    for (const bad of [
      null,
      { origins: ["03v"], mode: "fair" },
      { origins: ["03V", "130"], mode: "fair" },
      { origins: supported.slice(0, 2), mode: "x" },
    ]) {
      const checked = validateRecommend(data, bad);
      expect("code" in checked && errorSchema(problem(400, checked.code, checked.message))).toBe(true);
    }
  });

  it("가짜 서버가 내는 오류의 type은 열리는 /problems 문서이거나 about:blank다", () => {
    const known = new Set(PROBLEM_DOCS.map((p) => problemType(p)));
    const bodies: unknown[] = [
      { origins: supported.slice(0, 1), mode: "fair" },
      { origins: ["zzz", "zzy"], mode: "fair" },
      { origins: ["!", "?"], mode: "fair" },
      { origins: supported.slice(0, 2), mode: "x" },
      { origins: supported.slice(0, 2), mode: "favor" },
      { origins: supported.slice(0, 2), mode: "favor", favorIndex: 3 },
      { origins: supported.slice(0, 2), mode: "fair", favorIndex: "a" },
      { origins: supported.slice(0, 2), mode: "fair", nicknames: ["a"] },
      { origins: supported.slice(0, 2), mode: "fair", timeSlot: "nope" },
      "not an object",
    ];
    const issued = bodies.map((body) => validateRecommend(data, body));
    const problems = issued.flatMap((checked) =>
      "code" in checked ? [problem(400, checked.code, checked.message)] : [],
    );
    expect(problems).toHaveLength(bodies.length);
    for (const body of [...problems, problem(404, "NOT_FOUND", "x"), problem(500, "INTERNAL_ERROR", "x")]) {
      expect(known.has(body.type), `${body.code} → ${body.type}`).toBe(true);
    }
    // 실제 서버에 없는 경로는 문서 주소를 약속하지 않는다.
    expect(problem(501, "NOT_IMPLEMENTED", "x").type).toBe("about:blank");
  });

  it("오류 스키마는 Problem Details 필드를 모두 요구하고 옛 {code, message}는 받지 않는다", () => {
    expect(errorSchema(problem(409, "ROOM_FULL", "방이 가득 찼습니다"))).toBe(true);
    expect(errorSchema({ code: "ROOM_FULL", message: "방이 가득 찼습니다" })).toBe(false);
  });

  it("contracts/problems.json의 코드와 openapi의 코드 표가 같다", () => {
    const description = (doc.components.schemas.Problem as { description: string }).description;
    const inTable = new Set(
      description
        .split("\n")
        .filter((line) => /^\s*\| \d{3} \|/.test(line))
        .flatMap((line) => [...(line.split("|")[2] ?? "").matchAll(/`([A-Z_]+)`/g)].map((m) => m[1])),
    );
    const table = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../../contracts/problems.json"), "utf8"),
    ) as { problems: { code: string; status: number }[] };
    expect([...inTable].sort()).toEqual(table.problems.map((p) => p.code).sort());
    // 상태는 표의 줄 앞머리(`| 409 |`)와 같다.
    for (const { code, status } of table.problems) {
      const line = description.split("\n").find((l) => l.split("|")[2]?.includes(`\`${code}\``));
      expect(Number(line?.split("|")[1]), code).toBe(status);
    }
  });

  it("오류 응답은 모두 application/problem+json이다", () => {
    const responses = JSON.stringify(doc);
    expect(responses).not.toContain("components/schemas/Error");
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const failures = (operation as OperationResponses).responses ?? {};
        for (const [status, response] of Object.entries(failures)) {
          if (Number(status) < 400) continue;
          const content = "$ref" in response ? doc.components.responses?.Error?.content : response.content;
          expect(Object.keys(content ?? {}), `${method} ${path} ${status}`).toEqual(["application/problem+json"]);
        }
      }
    }
  });
});

describe("웹이 보내는 요청이 계약을 지킨다", () => {
  it.each([
    [
      {
        origins: ["03v", "130"],
        mode: "fair" as const,
        favorIndex: null,
        nicknames: null,
        timeSlot: "weekday-day" as const,
      },
    ],
    [
      {
        origins: ["03v", "130", "225"],
        mode: "fast" as const,
        favorIndex: null,
        nicknames: null,
        timeSlot: "saturday-night" as const,
      },
    ],
    [
      {
        origins: ["03v", "130"],
        mode: "favor" as const,
        favorIndex: 1,
        nicknames: ["민수", null],
        timeSlot: "holiday-morning" as const,
      },
    ],
  ])("%o", (query) => {
    const body = recommendBody(query);
    expect(requestSchema(body), JSON.stringify(requestSchema.errors)).toBe(true);
    expect("favorIndex" in body).toBe(query.mode === "favor");
    expect(body.timeSlot).toBe(query.timeSlot);
  });

  it("사람이 넣은 이름만 보낸다: 없는 사람은 null, 아무도 없으면 필드 생략", () => {
    const base = {
      origins: ["03v", "130", "225"],
      mode: "fair" as const,
      favorIndex: null,
      timeSlot: "weekday-day" as const,
    };
    expect(recommendBody({ ...base, nicknames: null })).not.toHaveProperty("nicknames");
    expect(recommendBody({ ...base, nicknames: [null, " ", null] })).not.toHaveProperty("nicknames");
    expect(recommendBody({ ...base, nicknames: [" 민수 ", null, ""] }).nicknames).toEqual(["민수", null, null]);
  });
});

describe("방 요청이 계약을 지킨다", () => {
  type Content = { content: Record<string, { schema: unknown }> };
  const compileBody = (path: string, method: "post" | "put") => {
    const operation = doc.paths[path]?.[method] as { requestBody?: Content } | undefined;
    return ajv.compile(rebased(operation?.requestBody?.content["application/json"]?.schema) as object);
  };
  const createSchema = compileBody("/rooms", "post");
  const participantSchema = compileBody("/rooms/{roomId}/participants", "post");
  const updateSchema = compileBody("/rooms/{roomId}/participants/{participantId}", "put");
  const outcomeSchema = compileBody("/rooms/{roomId}/outcome", "post");

  const gangnam = searchStations("강남").find((s) => s.name === "강남" && s.supported);
  if (!gangnam) throw new Error("테스트 역이 없다");
  const form = (patch: Partial<CreateRoomForm> = {}): CreateRoomForm => ({
    host: { nickname: "민수", station: gangnam, hidden: true },
    mode: "fair",
    meetingDate: "",
    meetingTime: "",
    meetingBand: null,
    expectedCount: null,
    ...patch,
  });

  it("방 만들기: 기본·배려·약속일·예상 인원 조합", () => {
    for (const patch of [
      {},
      { mode: "favor" as const },
      { meetingDate: "2026-11-20", expectedCount: 3 },
      { meetingDate: "2026-11-21", meetingTime: "19:30" },
      { meetingDate: "2026-11-21", meetingBand: "night" as const },
      { meetingBand: "morning" as const },
      { mode: "fast" as const, expectedCount: 4 },
    ]) {
      const checked = toCreateRoomRequest(form(patch), "2026-11-15");
      if (!checked.ok) throw new Error(checked.message);
      expect(createSchema(checked.value), JSON.stringify(createSchema.errors)).toBe(true);
    }
  });

  it("참여·수정 본문(이름 있음·없음, 숨김)과 outcome 본문", () => {
    for (const nickname of ["민수", ""]) {
      for (const hidden of [true, false]) {
        const checked = toParticipantInput({ nickname, station: gangnam, hidden });
        if (!checked.ok) throw new Error(checked.message);
        expect(participantSchema(checked.value), JSON.stringify(participantSchema.errors)).toBe(true);
        expect(updateSchema(checked.value)).toBe(true);
      }
    }
    for (const choice of [
      { kind: "top1" },
      { kind: "top3" },
      { kind: "none" },
      { kind: "other", station: gangnam },
    ] as const) {
      const checked = toOutcomeAnswer(choice);
      if (!checked.ok) throw new Error(checked.message);
      expect(outcomeSchema(checked.value), JSON.stringify(outcomeSchema.errors)).toBe(true);
    }
  });
});
