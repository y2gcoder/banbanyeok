import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeShareQuery, encodeShareQuery, type LinkErrorCode, type ShareState } from "./codec";

/** 계약 원본을 복사하지 않고 직접 읽는다(벡터가 바뀌면 이 테스트가 바로 따라간다). */
type Vectors = {
  formatVersion: number;
  path: string;
  encode: { id: string; input: ShareState; expectedQuery: string }[];
  decode: ({ id: string; query: string } & ({ expected: ShareState } | { expectedError: LinkErrorCode }))[];
};
const vectors = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../contracts/golden/link-vectors.json"), "utf8"),
) as Vectors;

describe("링크 코덱 — contracts/golden/link-vectors.json", () => {
  it("벡터 형식이 1판이고 경로가 /s다", () => {
    expect(vectors.formatVersion).toBe(1);
    expect(vectors.path).toBe("/s");
  });

  it.each(vectors.encode.map((v) => [v.id, v] as const))("encode %s", (_id, vector) => {
    expect(encodeShareQuery(vector.input)).toBe(vector.expectedQuery);
  });

  it.each(vectors.decode.map((v) => [v.id, v] as const))("decode %s", (_id, vector) => {
    const result = decodeShareQuery(vector.query);
    if ("expectedError" in vector) expect(result).toEqual({ ok: false, error: vector.expectedError });
    else expect(result).toEqual({ ok: true, state: vector.expected });
  });

  it("오류 코드 9개가 모두 벡터에 있다", () => {
    const codes = new Set(vectors.decode.flatMap((v) => ("expectedError" in v ? [v.expectedError] : [])));
    expect(codes.size).toBe(9);
  });
});

describe("링크 코덱 — 벡터 밖 경계", () => {
  it("앞의 ?를 허용한다", () => {
    expect(decodeShareQuery("?v=1&o=03v.130&m=f").ok).toBe(true);
  });

  it("인코더는 규칙을 어기는 상태를 거부한다", () => {
    const base: ShareState = { origins: ["03v", "130"], mode: "fair", favorIndex: null, nicknames: null };
    expect(() => encodeShareQuery({ ...base, origins: ["03v"] })).toThrow(RangeError);
    expect(() => encodeShareQuery({ ...base, mode: "favor", favorIndex: 2 })).toThrow(RangeError);
    expect(() => encodeShareQuery({ ...base, nicknames: ["a".repeat(21), null] })).toThrow(RangeError);
  });

  it("+는 공백이 아니다(별칭 세그먼트에서 거부)", () => {
    expect(decodeShareQuery("v=1&o=03v.130&m=f&n=a+b.7KeA")).toEqual({ ok: false, error: "BAD_NICKNAMES" });
  });
});
