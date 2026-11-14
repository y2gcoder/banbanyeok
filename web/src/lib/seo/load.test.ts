import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import { loadSeoSite } from "./load";

const web = resolve(import.meta.dirname, "../../..");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seo-load-"));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("산출물 읽기", () => {
  it("파일이 없으면 개발용 표본을 쓰고 표본임을 표시한다", () => {
    const site = loadSeoSite({}, web);
    // web 기준에서 ../data/artifacts/dev/seo-pairs.json이 생기면(P2c) 실제 산출물을 읽는다. 둘 중 하나여야 한다.
    expect(["fixture", "artifact"]).toContain(site.source);
    expect(site.pages.length).toBeGreaterThan(0);
  });

  it("작업 폴더 밖에 산출물도 표본도 없으면 표본 경로를 못 읽어 오류", () => {
    expect(() => loadSeoSite({}, dir)).toThrow();
  });

  it("SEO_PAIRS_FILE로 지정한 파일은 산출물로 본다", () => {
    const path = join(dir, "pairs.json");
    writeFileSync(path, JSON.stringify(fixture));
    const site = loadSeoSite({ SEO_PAIRS_FILE: path }, dir);
    expect(site.source).toBe("artifact");
    expect(site.dataVersion).toBe(fixture.dataVersion);
    expect(site.pages).toHaveLength(fixture.pairs.length);
  });

  it("지정한 파일이 없으면 조용히 표본으로 가지 않고 오류", () => {
    expect(() => loadSeoSite({ SEO_PAIRS_FILE: join(dir, "missing.json") }, dir)).toThrow("찾을 수 없습니다");
  });

  it("형식이 틀린 파일은 빌드를 멈춘다", () => {
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, dataVersion: "x", pairs: [] }));
    expect(() => loadSeoSite({ SEO_PAIRS_FILE: path }, dir)).toThrow("형식 오류");
  });

  it("manifest.json과 dataVersion이 다르면 경고한다(빌드는 계속)", () => {
    mkdirSync(join(dir, "art"));
    writeFileSync(join(dir, "art", "pairs.json"), JSON.stringify({ ...fixture, dataVersion: "20260101.1" }));
    writeFileSync(join(dir, "art", "manifest.json"), JSON.stringify({ dataVersion: "20261112.6" }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    loadSeoSite({ SEO_PAIRS_FILE: join(dir, "art", "pairs.json") }, dir);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dataVersion이 다릅니다"));
  });
});
