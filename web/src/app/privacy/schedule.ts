import type { Block, Policy, PolicyChange, UpcomingPolicy } from "./policy";

/**
 * 처리방침 예정 판의 날짜 판정. 모두 한국 시간(KST, 일광절약 없음) 날짜(YYYY-MM-DD)로 견준다.
 * 시계(`Date`)는 호출하는 쪽이 넣는다: 서버는 요청 때, 첫 화면의 공지 띠는 브라우저에서 읽는다.
 */

/** 처리방침 15항의 약속: 설명 보완·표현 정리와 이용 통계 재동의가 아닌 변경은 시행 7일 전부터 알린다. */
export const MIN_NOTICE_DAYS = 7;

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 3_600_000;

/** 공지 시작 전, 공지 중, 시행(예정 판이 지금 판). */
export type NoticePhase = "scheduled" | "notice" | "in-force";

export type NoticeWindow = Pick<UpcomingPolicy, "noticeFrom" | "effectiveDate">;

/** 한국 시간 기준 오늘(YYYY-MM-DD). */
export function kstDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 실제 달력에 있는 YYYY-MM-DD이면 그 날의 일수(1970-01-01부터), 아니면 null. */
function dayNumber(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return null;
  return ms / DAY_MS;
}

export function noticePhase({ noticeFrom, effectiveDate }: NoticeWindow, today: string): NoticePhase {
  if (today >= effectiveDate) return "in-force";
  return today >= noticeFrom ? "notice" : "scheduled";
}

/** "12월 1일". 올해가 아니면 "2027년 1월 1일"처럼 해를 붙인다. `year: true`면 늘 붙인다. */
export function koreanDate(iso: string, opts: { today: string } | { year: true }): string {
  const [y, m, d] = iso.split("-").map(Number);
  const withYear = "year" in opts || y !== Number(opts.today.slice(0, 4));
  return `${withYear ? `${y}년 ` : ""}${m}월 ${d}일`;
}

export type ResolvedPolicy = { policy: Policy; notice: UpcomingPolicy | null };

/** 지금 보여 줄 판과, 있다면 화면 맨 위에 알릴 예정 판. 시행일 0시(KST)에 예정 판이 지금 판이 된다. */
export function resolvePolicy(current: Policy, upcoming: UpcomingPolicy | null, now: Date): ResolvedPolicy {
  if (!upcoming) return { policy: current, notice: null };
  const phase = noticePhase(upcoming, kstDate(now));
  if (phase === "in-force") return { policy: upcoming.policy, notice: null };
  return { policy: current, notice: phase === "notice" ? upcoming : null };
}

/** 바뀌기 전과 후를 견주는 표. 화면과 docs/legal의 md가 같이 쓴다. */
export function changesTable(changes: readonly PolicyChange[]): Extract<Block, { kind: "table" }> {
  return {
    kind: "table",
    caption: "바뀌기 전과 후 비교",
    head: ["바뀌는 항목", "바뀌기 전", "바뀐 후"],
    rows: changes.map((c) => [c.item, c.before, c.after]),
  };
}

/** 예정 판 데이터가 약속을 지키는지 본다. 문제마다 한 줄. 없으면 빈 배열(테스트가 실제 데이터에 쓴다). */
export function upcomingProblems(upcoming: UpcomingPolicy | null): string[] {
  if (!upcoming) return [];
  const problems: string[] = [];
  const effective = dayNumber(upcoming.effectiveDate);
  const from = dayNumber(upcoming.noticeFrom);
  if (effective === null) problems.push(`시행일 ${upcoming.effectiveDate}은 실제 날짜(YYYY-MM-DD)가 아닙니다`);
  if (from === null) problems.push(`공지 시작일 ${upcoming.noticeFrom}은 실제 날짜(YYYY-MM-DD)가 아닙니다`);
  if (effective !== null && from !== null && effective - from < MIN_NOTICE_DAYS) {
    problems.push(`시행일은 공지 시작일보다 ${MIN_NOTICE_DAYS}일 이상 뒤여야 합니다(지금 ${effective - from}일)`);
  }
  if (upcoming.summary.trim() === "") problems.push("요약이 비어 있습니다");
  if (upcoming.changes.length === 0) problems.push("바뀌기 전과 후를 견주는 행이 없습니다");
  for (const { item, before, after } of upcoming.changes) {
    if ([item, before, after].some((text) => text.trim() === "")) problems.push(`비교 행 '${item}'에 빈 칸이 있습니다`);
  }
  if (upcoming.policy.sections.length === 0) problems.push("다음 판 본문이 비어 있습니다");
  return problems;
}
