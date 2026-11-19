import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./headers";

const names = (production: boolean, hsts: boolean) =>
  securityHeaders({ production, posthogHost: undefined, kakaoShare: false, hsts }).map((header) => header.key);

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("보안 헤더", () => {
  it("CSP는 PostHog 호스트가 있을 때만 connect-src에 넣는다", () => {
    expect(contentSecurityPolicy({ posthogHost: undefined, kakaoShare: false })).toContain("connect-src 'self';");
    expect(contentSecurityPolicy({ posthogHost: "https://us.i.posthog.com", kakaoShare: false })).toContain(
      "connect-src 'self' https://us.i.posthog.com;",
    );
  });

  it("외부 스크립트·프레임·플러그인을 허용하지 않는다", () => {
    const csp = contentSecurityPolicy({ posthogHost: "https://us.i.posthog.com", kakaoShare: false });
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(directive(csp, "script-src")).not.toMatch(/https?:/);
    expect(directive(csp, "frame-src")).toBeUndefined();
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("카카오 공유를 켠 빌드는 고정한 SDK 파일 하나와 공유에 쓰는 카카오 주소만 더 연다", () => {
    const csp = contentSecurityPolicy({ posthogHost: "https://us.i.posthog.com", kakaoShare: true });
    expect(directive(csp, "script-src")).toBe(
      "script-src 'self' 'unsafe-inline' https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js",
    );
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://us.i.posthog.com https://kapi.kakao.com");
    expect(directive(csp, "form-action")).toBe(
      "form-action 'self' https://sharer.kakao.com https://accounts.kakao.com",
    );
    expect(directive(csp, "frame-src")).toBe("frame-src 'self' kakaolink:");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("개발 서버에는 CSP를, HTTPS 정식 도메인이 없으면 HSTS를 붙이지 않는다", () => {
    expect(names(false, false)).not.toContain("Content-Security-Policy");
    expect(names(true, false)).toContain("Content-Security-Policy");
    expect(names(true, false)).not.toContain("Strict-Transport-Security");
    expect(names(true, true)).toContain("Strict-Transport-Security");
  });
});
