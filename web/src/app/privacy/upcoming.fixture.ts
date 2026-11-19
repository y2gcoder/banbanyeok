import { POLICY, type UpcomingPolicy } from "./policy";

/** 시험용 예정 판. 공지 시작 2026-12-01, 시행 2026-12-20(한국 시간 0시)이다. 실제 데이터(UPCOMING_POLICY)와 무관하다. */
export const FIXTURE_UPCOMING: UpcomingPolicy = {
  effectiveDate: "2026-12-20",
  noticeFrom: "2026-12-01",
  summary: "방 정보의 보관 기간을 7일에서 14일로 늘립니다. 처리하는 항목은 바뀌지 않습니다.",
  changes: [
    { item: "방 정보 보관 기간 (4항)", before: "마지막 변경 후 7일", after: "마지막 변경 후 14일" },
    { item: "만든 뒤 최대 보관 기간 (4항)", before: "30일", after: "30일 (바뀌지 않음)" },
  ],
  policy: {
    ...POLICY,
    title: "반반역 개인정보 처리방침 (다음 판)",
    sections: POLICY.sections.slice(0, 2),
  },
};

export const KST_BOUNDARIES = {
  /** 공지 시작일 전날 23:59:59(KST) */
  beforeNotice: new Date("2026-11-30T14:59:59Z"),
  /** 공지 시작일 0:00:00(KST) */
  noticeStart: new Date("2026-11-30T15:00:00Z"),
  /** 시행일 전날 23:59:59(KST) */
  lastNoticeSecond: new Date("2026-12-19T14:59:59Z"),
  /** 시행일 0:00:00(KST) */
  effectiveStart: new Date("2026-12-19T15:00:00Z"),
} as const;
