import { describe, expect, it } from "vitest";
import { absoluteUrl, isIndexableSite, siteUrl } from "./site";

describe("사이트 주소(SITE_URL)", () => {
  it("없으면 localhost 기본값, 있으면 끝의 /를 뗀 출처", () => {
    expect(siteUrl({})).toBe("http://localhost:3000");
    expect(siteUrl({ SITE_URL: "  " })).toBe("http://localhost:3000");
    expect(siteUrl({ SITE_URL: "https://banban.example/" })).toBe("https://banban.example");
    expect(siteUrl({ SITE_URL: "https://banban.example:8443" })).toBe("https://banban.example:8443");
  });

  it("URL이 아니거나 경로·쿼리가 있거나 http(s)가 아니면 빌드를 멈춘다", () => {
    expect(() => siteUrl({ SITE_URL: "banban.example" })).toThrow("URL이 아닙니다");
    expect(() => siteUrl({ SITE_URL: "ftp://banban.example" })).toThrow("http(s)");
    expect(() => siteUrl({ SITE_URL: "https://banban.example/app" })).toThrow("경로 없이");
    expect(() => siteUrl({ SITE_URL: "https://banban.example/?a=1" })).toThrow("경로 없이");
  });

  it("SITE_URL이 명시되고 localhost류가 아닐 때만 색인해도 된다", () => {
    expect(isIndexableSite({})).toBe(false);
    expect(isIndexableSite({ SITE_URL: "http://localhost:3000" })).toBe(false);
    expect(isIndexableSite({ SITE_URL: "http://127.0.0.1:3100" })).toBe(false);
    expect(isIndexableSite({ SITE_URL: "https://banban.example" })).toBe(true);
  });

  it("절대 주소를 만든다(한글 경로는 퍼센트 인코딩)", () => {
    const env = { SITE_URL: "https://banban.example" };
    expect(absoluteUrl("/meet/a1b-c2d", env)).toBe("https://banban.example/meet/a1b-c2d");
    expect(absoluteUrl("/", env)).toBe("https://banban.example/");
    expect(absoluteUrl("/한글", env)).toBe("https://banban.example/%ED%95%9C%EA%B8%80");
    expect(absoluteUrl("/meet", {})).toBe("http://localhost:3000/meet");
  });
});
