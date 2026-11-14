/**
 * PostHog 설정(환경 변수). 키가 없거나 올바르지 않으면 `null`이고, 그러면 통계는 완전히 꺼진다(네트워크 요청 0건).
 *
 * - `NEXT_PUBLIC_POSTHOG_KEY`: 프로젝트 토큰(`phc_...`). 공개해도 되는 값이다. 개인 API 키(`phx_...`)는 거부한다.
 * - `NEXT_PUBLIC_POSTHOG_HOST`: 수집 호스트. US `https://us.i.posthog.com` 또는 EU `https://eu.i.posthog.com`만 받는다
 *   (프록시·자체 호스팅은 이번 범위가 아니다). 키만 있고 호스트가 없거나 다르면 꺼 둔다(어느 리전으로 보낼지 추측하지 않는다).
 *
 * NEXT_PUBLIC_* 값은 빌드 때 번들에 박힌다. 바꾸면 다시 빌드해야 한다.
 */
export const POSTHOG_HOSTS = {
  us: "https://us.i.posthog.com",
  eu: "https://eu.i.posthog.com",
} as const;

export type AnalyticsConfig = {
  key: string;
  host: (typeof POSTHOG_HOSTS)[keyof typeof POSTHOG_HOSTS];
};

type PublicEnv = { key?: string | undefined; host?: string | undefined };

const PROJECT_TOKEN = /^phc_[A-Za-z0-9]{20,}$/;

export function analyticsConfig(env: PublicEnv): AnalyticsConfig | null {
  const key = env.key?.trim();
  if (!key || !PROJECT_TOKEN.test(key)) return null;
  const host = env.host?.trim().replace(/\/+$/, "");
  const known = Object.values(POSTHOG_HOSTS).find((candidate) => candidate === host);
  return known ? { key, host: known } : null;
}

/** 번들러가 리터럴 `process.env.NEXT_PUBLIC_*`만 바꿔 넣으므로 이름을 그대로 적는다. */
export function publicAnalyticsConfig(): AnalyticsConfig | null {
  return analyticsConfig({
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
}

/** 이벤트 공통 속성 `app_version`. 배포 파이프라인이 `NEXT_PUBLIC_APP_VERSION`(예: 커밋 해시)을 넣는다. */
export function appVersion(): string {
  return process.env.NEXT_PUBLIC_APP_VERSION?.trim() || "dev";
}
