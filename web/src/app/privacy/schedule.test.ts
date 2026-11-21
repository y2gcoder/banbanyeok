import { describe, expect, it } from "vitest";
import { POLICY, UPCOMING_POLICY } from "./policy";
import {
  changeNoticeProblems,
  changeNoticeShown,
  changesTable,
  koreanDate,
  kstDate,
  MIN_NOTICE_DAYS,
  noticePhase,
  resolveChangeNotice,
  resolvePolicy,
  upcomingProblems,
} from "./schedule";
import { FIXTURE_UPCOMING, KST_BOUNDARIES } from "./upcoming.fixture";

const { beforeNotice, noticeStart, lastNoticeSecond, effectiveStart } = KST_BOUNDARIES;

describe("kstDate", () => {
  it("UTC 15:00에 한국 날짜가 넘어간다", () => {
    expect(kstDate(new Date("2026-12-19T14:59:59.999Z"))).toBe("2026-12-19");
    expect(kstDate(new Date("2026-12-19T15:00:00Z"))).toBe("2026-12-20");
  });

  it("해가 바뀌는 경계도 한국 시간으로 본다", () => {
    expect(kstDate(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

describe("noticePhase", () => {
  const window = { noticeFrom: "2026-12-01", effectiveDate: "2026-12-20" };

  it("공지 시작일 전날은 공지 전, 시작일 당일부터 공지 중", () => {
    expect(noticePhase(window, "2026-11-30")).toBe("scheduled");
    expect(noticePhase(window, "2026-12-01")).toBe("notice");
  });

  it("시행일 전날까지 공지 중, 시행일 당일은 시행", () => {
    expect(noticePhase(window, "2026-12-19")).toBe("notice");
    expect(noticePhase(window, "2026-12-20")).toBe("in-force");
    expect(noticePhase(window, "2027-03-01")).toBe("in-force");
  });
});

describe("resolvePolicy (시각 경계, KST)", () => {
  it("예정 판이 없으면 지금 판만, 공지 없음", () => {
    expect(resolvePolicy(POLICY, null, effectiveStart)).toEqual({ policy: POLICY, notice: null });
  });

  it("공지 시작 1초 전: 지금 판, 공지 없음", () => {
    expect(resolvePolicy(POLICY, FIXTURE_UPCOMING, beforeNotice)).toEqual({ policy: POLICY, notice: null });
  });

  it("공지 시작일 0시: 지금 판 + 공지", () => {
    expect(resolvePolicy(POLICY, FIXTURE_UPCOMING, noticeStart)).toEqual({ policy: POLICY, notice: FIXTURE_UPCOMING });
  });

  it("시행일 전날 23:59:59: 아직 지금 판 + 공지", () => {
    expect(resolvePolicy(POLICY, FIXTURE_UPCOMING, lastNoticeSecond)).toEqual({
      policy: POLICY,
      notice: FIXTURE_UPCOMING,
    });
  });

  it("시행일 0시: 예정 판이 지금 판이 되고 공지가 사라진다", () => {
    expect(resolvePolicy(POLICY, FIXTURE_UPCOMING, effectiveStart)).toEqual({
      policy: FIXTURE_UPCOMING.policy,
      notice: null,
    });
  });
});

describe("koreanDate", () => {
  it("올해면 월·일만, 해가 다르면 해를 붙인다", () => {
    expect(koreanDate("2026-12-01", { today: "2026-11-20" })).toBe("12월 1일");
    expect(koreanDate("2027-01-05", { today: "2026-12-30" })).toBe("2027년 1월 5일");
    expect(koreanDate("2026-12-01", { year: true })).toBe("2026년 12월 1일");
  });
});

describe("changesTable", () => {
  it("바뀌기 전과 후를 항목별 행으로 만든다", () => {
    const table = changesTable(FIXTURE_UPCOMING.changes);
    expect(table.head).toEqual(["바뀌는 항목", "바뀌기 전", "바뀐 후"]);
    expect(table.rows[0]).toEqual(["방 정보 보관 기간 (4항)", "마지막 변경 후 7일", "마지막 변경 후 14일"]);
  });
});

describe("upcomingProblems", () => {
  it("실제 데이터는 약속을 지킨다(예정 판이 없으면 문제도 없다)", () => {
    expect(upcomingProblems(UPCOMING_POLICY)).toEqual([]);
  });

  it("시험용 예정 판은 통과한다", () => {
    expect(upcomingProblems(FIXTURE_UPCOMING)).toEqual([]);
  });

  it(`시행일이 공지 시작일보다 ${MIN_NOTICE_DAYS}일 이상 뒤면 통과, 하루라도 모자라면 실패`, () => {
    const at = (noticeFrom: string, effectiveDate: string) =>
      upcomingProblems({ ...FIXTURE_UPCOMING, noticeFrom, effectiveDate });
    expect(at("2026-12-01", "2026-12-08")).toEqual([]);
    expect(at("2026-12-01", "2026-12-07")).toEqual([expect.stringContaining("7일 이상")]);
    expect(at("2026-12-01", "2026-12-01")).toEqual([expect.stringContaining("7일 이상")]);
    expect(at("2026-12-10", "2026-12-01")).toEqual([expect.stringContaining("7일 이상")]);
  });

  it("달력에 없는 날짜와 형식 오류를 잡는다", () => {
    const bad = upcomingProblems({ ...FIXTURE_UPCOMING, noticeFrom: "2026-02-30", effectiveDate: "12/20" });
    expect(bad).toHaveLength(2);
  });

  it("빈 요약·빈 비교표·빈 칸을 잡는다", () => {
    expect(upcomingProblems({ ...FIXTURE_UPCOMING, summary: " ", changes: [] })).toHaveLength(2);
    expect(
      upcomingProblems({ ...FIXTURE_UPCOMING, changes: [{ item: "보관 기간", before: "", after: "14일" }] }),
    ).toEqual([expect.stringContaining("빈 칸")]);
  });
});

describe("중요한 변경 안내(15항)", () => {
  const notice = {
    since: "2026-12-01",
    until: "2026-12-07",
    summary: "보관 기간을 바꿨습니다.",
    rows: [{ item: "보관 기간 (4항)", before: "7일", after: "14일" }],
    previous: { label: "이전 판", url: "https://example.org/old.md" },
  };

  it("시행일부터 끝나는 날까지(양쪽 포함, 한국 시간)만 보인다", () => {
    expect(changeNoticeShown(notice, "2026-11-30")).toBe(false);
    expect(changeNoticeShown(notice, "2026-12-01")).toBe(true);
    expect(changeNoticeShown(notice, "2026-12-07")).toBe(true);
    expect(changeNoticeShown(notice, "2026-12-08")).toBe(false);
    expect(resolveChangeNotice(notice, new Date("2026-11-30T15:00:00Z"))).toBe(notice);
    expect(resolveChangeNotice(notice, new Date("2026-12-07T15:00:00Z"))).toBeNull();
    expect(resolveChangeNotice(null, new Date("2026-12-02T00:00:00Z"))).toBeNull();
  });

  it("약속한 일수·빈 칸·실제 날짜를 검사한다", () => {
    expect(changeNoticeProblems(notice, 7)).toEqual([]);
    expect(changeNoticeProblems(null, 7)).toEqual([]);
    expect(changeNoticeProblems({ ...notice, until: "2026-12-05" }, 7)).toEqual([
      "안내 기간은 시행일부터 7일이어야 합니다(지금 5일)",
    ]);
    expect(changeNoticeProblems({ ...notice, since: "2026-02-30" }, 7)[0]).toContain("실제 날짜");
    expect(changeNoticeProblems({ ...notice, rows: [] }, 7)).toContain("바뀌기 전과 후를 견주는 행이 없습니다");
  });
});
