import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Mode } from "@/lib/api/types";
import { banbanLine, mayIncludeHidden } from "./banban-index";

type Vector = {
  id: string;
  mode: Mode;
  minutes: (number | null)[];
  hidden: boolean;
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
    expect(banbanLine({ mode: v.mode, minutes: v.minutes, hidden: v.hidden })).toEqual(v.expected);
  });

  it("기본 층은 최장이 1시간 미만이면 '도' 형, 정각 1시간부터 명사형이다(운영자 결정 14)", () => {
    const longest = (minutes: number[]) => banbanLine({ mode: "fair", minutes, hidden: false })?.text;
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

describe("방 미리보기의 숨김 짐작(서버는 숨긴 사람의 시간을 300초의 배수로 준다)", () => {
  it("300초의 배수인 시간이 하나라도 있으면 숨긴 사람이 있을 수 있다고 본다", () => {
    expect(mayIncludeHidden([1200, 1290])).toBe(true);
    expect(mayIncludeHidden([300, null])).toBe(true);
    expect(mayIncludeHidden([1260, 1290])).toBe(false);
    expect(mayIncludeHidden([1199, null])).toBe(false);
  });
});
