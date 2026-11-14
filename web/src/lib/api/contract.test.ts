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
import { loadMockData, validateRecommend } from "../../../mock/server";
import { recommendBody } from "./client";

type OpenApi = {
  components: { schemas: Record<string, unknown> };
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
const errorSchema = ajv.compile({ $ref: "contract#/$defs/Error" });
const requestSchema = ajv.compile(
  rebased(doc.paths["/recommend"]?.post?.requestBody?.content["application/json"]?.schema) as object,
);

const data = loadMockData();
const supported = [...data.origins.keys()];
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
      expect("code" in checked && errorSchema(checked)).toBe(true);
    }
  });
});

describe("웹이 보내는 요청이 계약을 지킨다", () => {
  it.each([
    [{ origins: ["03v", "130"], mode: "fair" as const, favorIndex: null }],
    [{ origins: ["03v", "130", "225"], mode: "fast" as const, favorIndex: null }],
    [{ origins: ["03v", "130"], mode: "favor" as const, favorIndex: 1 }],
  ])("%o", (query) => {
    const body = recommendBody(query);
    expect(requestSchema(body), JSON.stringify(requestSchema.errors)).toBe(true);
    expect("favorIndex" in body).toBe(query.mode === "favor");
  });
});
