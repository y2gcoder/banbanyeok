import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "./canonical";

describe("canonicalRedirect", () => {
  it("정식 호스트가 비어 있으면 그대로 둔다", () => {
    expect(canonicalRedirect(new Request("https://banbanyeok-web.sub.workers.dev/"), undefined)).toBeNull();
    expect(canonicalRedirect(new Request("https://banbanyeok-web.sub.workers.dev/"), "  ")).toBeNull();
  });
  it("다른 호스트는 경로·쿼리를 보존해 301로 정식 주소에 보낸다(GET)", () => {
    const response = canonicalRedirect(
      new Request("https://banbanyeok-web.sub.workers.dev/s?o=a.b#x"),
      "Banban.Example",
    );
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://banban.example/s?o=a.b");
  });
  it("www와 POST도 이동시키되 POST는 308", () => {
    expect(canonicalRedirect(new Request("https://www.banban.example/"), "banban.example")?.status).toBe(301);
    const post = canonicalRedirect(
      new Request("https://x.workers.dev/api/v1/recommend", { method: "POST", body: "{}" }),
      "banban.example",
    );
    expect(post?.status).toBe(308);
  });
  it("정식 호스트라도 http면 https로 올린다", () => {
    const response = canonicalRedirect(new Request("http://banban.example/meet?x=1"), "banban.example");
    expect(response?.status).toBe(301);
    expect(response?.headers.get("location")).toBe("https://banban.example/meet?x=1");
  });
  it("정식 호스트이면 그대로 둔다", () => {
    expect(canonicalRedirect(new Request("https://banban.example/meet"), "banban.example")).toBeNull();
  });
});
