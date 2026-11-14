import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./headers";

const names = (production: boolean, hsts: boolean) =>
  securityHeaders({ production, posthogHost: undefined, hsts }).map((header) => header.key);

describe("보안 헤더", () => {
  it("CSP는 PostHog 호스트가 있을 때만 connect-src에 넣는다", () => {
    expect(contentSecurityPolicy(undefined)).toContain("connect-src 'self';");
    expect(contentSecurityPolicy("https://us.i.posthog.com")).toContain("connect-src 'self' https://us.i.posthog.com;");
  });

  it("외부 스크립트·프레임·플러그인을 허용하지 않는다", () => {
    const csp = contentSecurityPolicy("https://us.i.posthog.com");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
  });

  it("개발 서버에는 CSP를, HTTPS 정식 도메인이 없으면 HSTS를 붙이지 않는다", () => {
    expect(names(false, false)).not.toContain("Content-Security-Policy");
    expect(names(true, false)).toContain("Content-Security-Policy");
    expect(names(true, false)).not.toContain("Strict-Transport-Security");
    expect(names(true, true)).toContain("Strict-Transport-Security");
  });
});
