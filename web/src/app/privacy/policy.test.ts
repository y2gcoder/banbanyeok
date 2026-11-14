import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { policyMarkdown } from "./markdown";
import { CONTACT_EMAIL, POLICY, REQUIRED_PLACEHOLDERS } from "./policy";

const mdPath = resolve(import.meta.dirname, "../../../../docs/legal/privacy-policy.md");
const markdown = policyMarkdown(POLICY);

describe("개인정보 처리방침", () => {
  it("docs/legal/privacy-policy.md가 페이지와 같은 원본에서 나온다", () => {
    if (process.env.UPDATE_PRIVACY_MD) writeFileSync(mdPath, markdown);
    expect(readFileSync(mdPath, "utf8"), "policy.ts를 고쳤다면 UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy").toBe(
      markdown,
    );
  });

  it("법이 요구하는 항목을 모두 다룬다", () => {
    const titles = POLICY.sections.map((s) => s.title).join("\n");
    for (const topic of [
      "목적",
      "항목",
      "14세",
      "보유",
      "파기",
      "제3자 제공",
      "위탁",
      "국외 이전",
      "권리",
      "안전성",
      "쿠키",
      "자동화된 결정",
      "보호책임자",
      "구제",
      "변경",
      "시행일",
    ]) {
      expect(titles).toContain(topic);
    }
  });

  it("운영자 이름·시행일은 자리표시로 남고, 이메일은 전용 연락 주소만 쓴다(개인 메일을 넣지 않는다)", () => {
    for (const placeholder of REQUIRED_PLACEHOLDERS) expect(markdown).toContain(placeholder);
    expect(markdown).toContain(CONTACT_EMAIL);
    expect(markdown.replaceAll(CONTACT_EMAIL, "")).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it("목차 앵커가 겹치지 않는다", () => {
    const ids = POLICY.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
