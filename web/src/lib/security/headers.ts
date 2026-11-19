/**
 * 보안 응답 헤더(next.config.ts `headers()`가 모든 경로에 붙인다).
 *
 * CSP는 현실적인 최소 규칙이다:
 * - 스크립트는 같은 출처 + 인라인(Next의 하이드레이션 스크립트). nonce 방식은 모든 페이지를 요청마다 렌더해야 해서(정적 SEO 페이지·
 *   Workers CPU 한도와 충돌) 쓰지 않는다. PostHog는 `posthog-js/no-external` 번들을 동의 뒤 동적 import하므로 같은 출처 스크립트다.
 * - 네트워크 연결은 같은 출처(`/api/*` 프록시) + PostHog 수집 호스트(빌드에 키가 있을 때만)로 제한한다.
 * - 카카오톡 공유(빌드에 카카오 앱 키가 있을 때만): 고정한 SDK 파일 하나(SRI 해시도 건다)와 SDK가 공유할 때 쓰는 카카오 주소만 연다.
 * - 개발 서버(`next dev`)는 HMR이 eval·websocket을 쓰므로 CSP를 붙이지 않는다(운영 빌드에서만 강제, e2e가 운영 빌드로 확인).
 */
import { KAKAO_SDK, KAKAO_SHARE_CSP } from "../share/kakao";

type Header = { key: string; value: string };

export type SecurityHeaderOptions = {
  /** `next build`/`next start` 여부. 개발 서버에서는 CSP를 끈다. */
  production: boolean;
  /** 허용할 PostHog 수집 호스트(출처). 통계가 꺼진 빌드면 undefined. */
  posthogHost: string | undefined;
  /** 카카오톡 공유 API를 켠 빌드(카카오 앱 키가 있음)인가. */
  kakaoShare: boolean;
  /** HTTPS 정식 도메인이 있을 때만 HSTS(workers.dev 단계에서는 켜지 않는다). */
  hsts: boolean;
};

type CspOptions = Pick<SecurityHeaderOptions, "posthogHost" | "kakaoShare">;

export function contentSecurityPolicy({ posthogHost, kakaoShare }: CspOptions): string {
  const kakao = (...list: string[]) => (kakaoShare ? list : []);
  const sources = (...list: string[]) => list.join(" ");
  return [
    "default-src 'self'",
    sources("script-src 'self' 'unsafe-inline'", ...kakao(KAKAO_SDK.src)),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    sources("connect-src 'self'", ...(posthogHost ? [posthogHost] : []), ...kakao(KAKAO_SHARE_CSP.connect)),
    "worker-src 'self' blob:",
    ...kakao(`frame-src 'self' ${KAKAO_SHARE_CSP.frame}`),
    "object-src 'none'",
    "base-uri 'self'",
    sources("form-action 'self'", ...kakao(...KAKAO_SHARE_CSP.formAction)),
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders({ production, posthogHost, kakaoShare, hsts }: SecurityHeaderOptions): Header[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    ...(production
      ? [{ key: "Content-Security-Policy", value: contentSecurityPolicy({ posthogHost, kakaoShare }) }]
      : []),
    ...(hsts ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}
