/**
 * 통계 동의 문구. 배너와 /privacy 설정이 같은 문구를 쓴다(방침 web/src/app/privacy/policy.ts 2·3·7·11항과 일치해야 한다).
 * 고치면 CONSENT_VERSION(src/lib/analytics/consent.ts)을 올려 다시 묻는다.
 *
 * 동의는 두 항목을 각각 받는다: 수집·이용(제22조), 국외 이전(제28조의8①1호). 둘 다 동의해야 통계를 켠다.
 */
export const CONSENT_COPY = {
  question: "서비스 개선을 위해 이용 통계를 모아도 될까요?",
  intro: "출발역과 이름은 모으지 않아요. 만 14세 이상만 동의할 수 있고, 동의하지 않아도 서비스는 모두 쓸 수 있어요.",
  rule: "아래 두 가지에 모두 동의해야 통계를 모아요.",
  collect: {
    label: "이용 통계 수집·이용에 동의해요 (선택)",
    detail: "어떤 기능을 얼마나 쓰는지(기능별 이용 기록, 무작위 식별자)를 서비스 개선에만 써요.",
  },
  transfer: {
    label: "통계 정보를 미국 PostHog, Inc.로 보내는 데 동의해요 (선택)",
    detail: "위 정보를 암호화해 미국으로 보내 분석해요. 보유 기간은 처리방침에서 볼 수 있어요.",
  },
  later: "언제든 개인정보 처리방침의 통계 설정에서 바꿀 수 있어요.",
  save: "선택한 대로 저장",
  rejectAll: "모두 거부",
} as const;
