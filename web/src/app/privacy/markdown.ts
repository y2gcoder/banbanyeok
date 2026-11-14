import type { Block, Policy } from "./policy";

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

/** docs/legal/privacy-policy.md 본문. 페이지와 같은 원본(policy.ts)에서 만든다. */
export function policyMarkdown(policy: Policy): string {
  const parts = [
    `# ${policy.title}`,
    `> **${policy.draftWarning}**`,
    "<!-- 이 파일은 web/src/app/privacy/policy.ts에서 만든다. 직접 고치지 말고 policy.ts를 고친 뒤 `UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy`를 실행한다. -->",
    ...policy.intro,
    "## 한눈에 보기",
    policy.summary.map((line) => `- ${line}`).join("\n"),
    "## 목차",
    policy.sections.map((s, i) => `${i + 1}. ${s.title.replace(/^\d+\.\s*/, "")}`).join("\n"),
    ...policy.sections.flatMap((s) => [`## ${s.title}`, ...s.blocks.map(block)]),
  ];
  return `${parts.join("\n\n")}\n`;
}
