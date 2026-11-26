import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { CONSENT_VERSION } from "@/lib/analytics/consent";
import { CONSENT_COPY, CONSENT_NOTICE } from "./consent-text";

it("동의 문구와 버전은 ADR-0001의 재동의 판단과 함께 갱신한다", () => {
  const sha256 = createHash("sha256").update(JSON.stringify({ CONSENT_COPY, CONSENT_NOTICE })).digest("hex");

  // 문구 변경 때 ADR-0001로 버전 유지/인상을 판단하고, 아래 해시와 같은 줄에 '재동의 필요/불필요'와 이유를 남긴다.
  expect(
    { version: CONSENT_VERSION, sha256 },
    "docs/adr/0001-consent-version-rule.md를 확인하고 해시 줄에 재동의 필요/불필요와 이유를 기록하세요.",
  ).toEqual({
    version: 4,
    sha256: "bb9419973b455a0c106cced3b2fc0aebee6f04069ca9f80380c90f01acbf243b", // ADR-0001: 재동의 불필요 — PostHog 항목·목적·보유 기간·이전 조건은 그대로이고 자체 합계를 구분.
  });
});
