import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LINE_LABELS } from "../../../scripts/station-lines.ts";
import { EXCLUDED_PLACES, SUPPORTED_LINES, UNSUPPORTED_REASONS, unsupportedReason } from "./coverage";
import { type Station, searchStations } from "./index";
import raw from "./index.gen.json";
import { isCapitalAreaLine } from "./lines";

/** 범위를 정한 원본(파이프라인 입력). 이유 문구 표가 여기와 어긋나지 않게 본다. */
const tagoScope = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../../../../data/config/tago-scope.json"), "utf8"),
) as { excludedStations: Record<string, string>; excludedRoutes: Record<string, string> };

type RawStation = [string, string, number[], string[], number, ...number[]];
const rawStations = raw.stations as RawStation[];
const unsupported = rawStations.filter((s) => s[4] === 0);
const asStation = ([code, , lineIdx, , ok]: RawStation) => ({
  code,
  lines: lineIdx.map((i) => raw.lines[i] ?? ""),
  supported: ok === 1,
});

describe("계산 범위", () => {
  it("노선 목록은 계산할 수 있는 역이 있는 노선 전부이고, 숫자 노선이 먼저다", () => {
    const expected = new Set(rawStations.filter((s) => s[4] === 1).flatMap((s) => s[2].map((i) => raw.lines[i])));
    expect(new Set(SUPPORTED_LINES)).toEqual(expected);
    expect(SUPPORTED_LINES.slice(0, 9)).toEqual([
      "1호선",
      "2호선",
      "3호선",
      "4호선",
      "5호선",
      "6호선",
      "7호선",
      "8호선",
      "9호선",
    ]);
    expect(SUPPORTED_LINES).not.toContain("인천자기부상");
    expect(SUPPORTED_LINES.every(isCapitalAreaLine)).toBe(true);
  });

  it("빠진 곳은 일부 역만 빠진 노선은 역 이름으로, 통째로 빠진 노선은 노선 이름으로", () => {
    expect(EXCLUDED_PLACES).toEqual(["임진강·운천(경의중앙선)", "인천자기부상"]);
  });

  it("계산하지 않는 역마다 표에 적은 이유가 붙는다(일반 문구로 떨어지지 않는다)", () => {
    expect(unsupported.length).toBeGreaterThan(0);
    const texts = new Set(UNSUPPORTED_REASONS.map((r) => r.text));
    for (const s of unsupported) expect(texts.has(unsupportedReason(asStation(s)) ?? ""), s[1]).toBe(true);
  });

  it("이유 표의 각 줄은 tago-scope.json의 같은 역·노선 제외 항목에 대응한다", () => {
    // 원본 설명은 "운천: …", "인천공항 자기부상철도: …"처럼 대상 이름으로 시작한다. 키만 있는지가 아니라 그 이름이 표의 역·노선과 같은지 본다.
    const subject = (description: string | undefined) => description?.split(":")[0]?.trim();
    for (const r of UNSUPPORTED_REASONS) {
      if (r.station !== undefined) {
        const name = rawStations.find((s) => s[0] === r.station)?.[1];
        expect(name, `${r.station}가 역 인덱스에 없다`).toBeDefined();
        expect(subject(tagoScope.excludedStations[r.tago]), `${r.tago} ↔ ${r.station}`).toBe(name);
      } else {
        // 노선은 원천 노선명(LINE_LABELS 키) → 표시 노선명으로 맞춘다: "자기부상철도" → "인천자기부상".
        const route = subject(tagoScope.excludedRoutes[r.tago]);
        expect(route, `${r.tago}가 excludedRoutes에 없다`).toBeDefined();
        const sourceNames = Object.entries(LINE_LABELS)
          .filter(([, label]) => label === r.line)
          .map(([source]) => source);
        expect(sourceNames.length, `${r.line}의 원천 노선명이 없다`).toBeGreaterThan(0);
        expect(
          sourceNames.some((source) => route?.includes(source)),
          `${r.tago}(${route}) ↔ ${r.line}`,
        ).toBe(true);
      }
    }
  });

  it("계산할 수 있는 역에는 이유가 없다", () => {
    const gangnam = searchStations("강남").find((s) => s.name === "강남") as Station;
    expect(unsupportedReason(gangnam)).toBeNull();
  });

  it("표에 없는 역은 노선으로 일반 문구를 고른다", () => {
    expect(unsupportedReason({ code: "zzz", lines: ["2호선"], supported: false })).toBe(
      "아직 계산하지 못하는 역이에요",
    );
    expect(unsupportedReason({ code: "zzz", lines: ["부산1호선"], supported: false })).toBe(
      "아직 수도권 전철만 계산해요",
    );
  });
});
