import type { Block, Policy, UpcomingPolicy } from "./policy";
import { changesTable, koreanDate } from "./schedule";

const cell = (text: string) => text.replaceAll("|", "\\|");

function block(b: Block): string {
  switch (b.kind) {
    case "p":
      return b.text;
    case "list":
      return b.items.map((item) => `- ${item}`).join("\n");
    case "table":
      return [
        `**${b.caption}**`,
        "",
        `| ${b.head.map(cell).join(" | ")} |`,
        `|${b.head.map(() => "---").join("|")}|`,
        ...b.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      ].join("\n");
  }
}

function upcomingSection(upcoming: UpcomingPolicy): string[] {
  return [
    "## 예정된 변경",
    [
      `- 시행일: ${koreanDate(upcoming.effectiveDate, { year: true })}(한국 시간 0시부터)`,
      `- 공지 시작일: ${koreanDate(upcoming.noticeFrom, { year: true })}`,
    ].join("\n"),
    upcoming.summary,
    block(changesTable(upcoming.changes)),
    "위 변경은 시행일 전까지 적용되지 않으며, 이 문서의 나머지는 지금 시행 중인 판입니다.",
  ];
}

/**
 * docs/legal/privacy-policy.md 본문. 페이지와 같은 원본(policy.ts)에서 만든다. 항상 지금 시행 중인 판(POLICY)이고,
 * 예정된 다음 판이 있으면 끝에 '예정된 변경' 절을 붙인다. 오늘 날짜에 따라 달라지지 않는다.
 */
export function policyMarkdown(policy: Policy, upcoming: UpcomingPolicy | null = null): string {
  const parts = [
    `# ${policy.title}`,
    "<!-- 이 파일은 web/src/app/privacy/policy.ts에서 만든다. 직접 고치지 말고 policy.ts를 고친 뒤 `UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy`를 실행한다. -->",
    ...policy.intro,
    "## 한눈에 보기",
    policy.summary.map((line) => `- ${line}`).join("\n"),
    "## 목차",
    policy.sections.map((s, i) => `${i + 1}. ${s.title.replace(/^\d+\.\s*/, "")}`).join("\n"),
    ...policy.sections.flatMap((s) => [`## ${s.title}`, ...s.blocks.map(block)]),
    ...(upcoming ? upcomingSection(upcoming) : []),
  ];
  return `${parts.join("\n\n")}\n`;
}
