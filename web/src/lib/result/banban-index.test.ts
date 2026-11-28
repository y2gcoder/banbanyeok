import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Mode } from "@/lib/api/types";
import { banbanLine } from "./banban-index";

type Vector = {
  id: string;
  mode: Mode;
  minutes: (number | null)[];
  expected: { kind: "longest" | "close"; text: string } | null;
};

const doc = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../contracts/golden/banban-lines.json"), "utf8"),
) as { vectors: Vector[] };

describe("반반지수 한 줄 — contracts/golden/banban-lines.json(prototype/banban_index.py)", () => {
  it("벡터가 고정 사례와 무작위 사례를 모두 담고 있다", () => {
    expect(doc.vectors.length).toBeGreaterThan(1000);
    expect(doc.vectors.filter((v) => v.expected?.kind === "close").length).toBeGreaterThan(100);
    expect(doc.vectors.filter((v) => v.expected?.text.includes("시간")).length).toBeGreaterThan(100);
  });

  it.each(doc.vectors.map((v) => [v.id, v] as const))("%s", (_, v) => {
    expect(banbanLine({ mode: v.mode, minutes: v.minutes })).toEqual(v.expected);
  });

  it("기본 층은 최장이 1시간 미만이면 '도' 형, 정각 1시간부터 명사형이다(운영자 결정 14)", () => {
    const longest = (minutes: number[]) => banbanLine({ mode: "fair", minutes })?.text;
    expect(longest([40, 59])).toBe("가장 오래 걸리는 사람도 59분이에요");
    expect(longest([40, 60])).toBe("가장 오래 걸리는 사람 1시간");
    expect(longest([40, 61])).toBe("가장 오래 걸리는 사람 1시간 1분");
    expect(longest([46, 53, 94])).toBe("가장 오래 걸리는 사람 1시간 34분");
    expect(longest([93, 94])).toBe("걸리는 시간이 두 사람 1분 차이예요");
    for (const v of doc.vectors) {
      if (v.expected?.kind !== "longest") continue;
      const max = Math.max(...v.minutes.map((m) => m ?? 0));
      expect(v.expected.text.startsWith(max < 60 ? "가장 오래 걸리는 사람도 " : "가장 오래 걸리는 사람 ")).toBe(true);
      expect(v.expected.text.endsWith("이에요")).toBe(max < 60);
    }
  });

  it("문장은 화면의 분 차이만 말하고 '도착'은 쓰지 않는다", () => {
    for (const v of doc.vectors) expect(v.expected?.text ?? "").not.toContain("도착");
  });
});
