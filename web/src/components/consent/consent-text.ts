/**
 * 통계 동의 문구. 배너와 /privacy 설정이 같은 문구를 쓴다(방침 docs/legal/privacy-policy.md 2·3·7절과 일치해야 한다).
 * 고치면 CONSENT_VERSION(src/lib/analytics/consent.ts)을 올려 다시 묻는다.
 */
export const CONSENT_COPY = {
  question: "서비스 개선을 위해 이용 통계를 모아도 될까요?",
  detail: "출발역과 이름은 모으지 않아요. 통계는 해외 서버(PostHog)에서 처리돼요. 만 14세 이상만 동의할 수 있어요.",
  later: "언제든 개인정보 처리방침의 통계 설정에서 바꿀 수 있어요.",
  accept: "동의",
  reject: "거부",
} as const;
