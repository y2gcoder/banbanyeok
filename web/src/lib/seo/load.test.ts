import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fixture from "../../../fixtures/seo-pairs.json";
import { loadSeoSite } from "./load";
import { MEANINGFUL } from "./pair-pages";
import { parseSeoPairs } from "./pairs";

const web = resolve(import.meta.dirname, "../../..");
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seo-load-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

describe("실제 산출물(data/artifacts/dev/seo-pairs.json)", () => {
  const env = {};
  const file = parseSeoPairs(readFileSync(resolve(web, "../data/artifacts/dev/seo-pairs.json"), "utf8"));

  it("기본 경로의 파일을 읽고 manifest와 대조해 통과한다", () => {
    const site = loadSeoSite(env, web);
    expect(site.dataVersion).toBe(file.dataVersion);
    // 문장 내용에는 의존하지 않는다(이유 문장은 파이프라인이 다시 만든다). 수와 형식만 본다.
    expect(site.pages.length + site.skipped.length).toBe(file.pairs.length);
    expect(site.pages.length).toBeGreaterThan(0);
  });

  it("모든 페이지는 정규 주소·후보 둘 이상·의미 있는 범위다", () => {
    const { pages } = loadSeoSite(env, web);
    for (const page of pages) {
      expect(page.path).toBe(`/meet/${page.slug}`);
      expect(page.candidates.length).toBeGreaterThanOrEqual(MEANINGFUL.minResults);
      const top = page.candidates[0];
      expect(top?.people.map((p) => p.seconds).some((s) => s > MEANINGFUL.minTopSeconds)).toBe(true);
    }
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
  });

  it("거른 쌍은 이유가 남는다", () => {
    for (const skipped of loadSeoSite(env, web).skipped) expect(skipped.reason).not.toBe("");
  });
});

describe("파일 찾기와 검증", () => {
  it("SEO_PAIRS_FILE로 경로를 바꾼다", () => {
    const site = loadSeoSite({ SEO_PAIRS_FILE: write("pairs.json", fixture) }, dir);
    expect(site.dataVersion).toBe(fixture.dataVersion);
    expect(site.pages).toHaveLength(fixture.pairs.length);
  });

  it("파일이 없으면 조용히 넘어가지 않고 빌드를 멈춘다", () => {
    expect(() => loadSeoSite({}, dir)).toThrow("seo-pairs.json을 찾을 수 없습니다");
    expect(() => loadSeoSite({ SEO_PAIRS_FILE: join(dir, "missing.json") }, dir)).toThrow("찾을 수 없습니다");
  });

  it("형식이 틀린 파일은 빌드를 멈춘다", () => {
    const path = write("bad.json", { schemaVersion: 1, dataVersion: "x", pairs: [] });
    expect(() => loadSeoSite({ SEO_PAIRS_FILE: path }, dir)).toThrow("형식 오류");
  });
});

describe("manifest 대조(files.seoPages)", () => {
  function setup(manifest: unknown): string {
    mkdirSync(join(dir, "art"), { recursive: true });
    write("art/manifest.json", manifest);
    return write("art/pairs.json", fixture);
  }
  const text = JSON.stringify(fixture);
  const entry = {
    path: "pairs.json",
    bytes: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };

  it("바이트 수와 sha256이 맞으면 통과한다", () => {
    const path = setup({ dataVersion: fixture.dataVersion, files: { seoPages: entry } });
    expect(loadSeoSite({ SEO_PAIRS_FILE: path }, dir).pages.length).toBeGreaterThan(0);
  });

  it("해시가 다르면(파일이 바뀌었거나 오래됨) 거부한다", () => {
    const path = setup({ dataVersion: fixture.dataVersion, files: { seoPages: { ...entry, sha256: "0".repeat(64) } } });
    expect(() => loadSeoSite({ SEO_PAIRS_FILE: path }, dir)).toThrow("sha256");
  });

  it("dataVersion이 다르면 거부한다", () => {
    const path = setup({ dataVersion: "20260101.1", files: { seoPages: entry } });
    expect(() => loadSeoSite({ SEO_PAIRS_FILE: path }, dir)).toThrow("dataVersion이 다릅니다");
  });

  it("manifest가 seoPages를 적지 않았으면 dataVersion만 본다", () => {
    const path = setup({ dataVersion: fixture.dataVersion, files: {} });
    expect(loadSeoSite({ SEO_PAIRS_FILE: path }, dir).dataVersion).toBe(fixture.dataVersion);
  });
});
