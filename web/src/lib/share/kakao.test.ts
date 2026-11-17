import { describe, expect, it } from "vitest";
import { kakaoJsKey } from "./kakao";

describe("카카오 앱 키", () => {
  it("JavaScript 키(16진수 32자)만 받고, 없거나 다른 모양이면 카카오 공유를 끈다", () => {
    expect(kakaoJsKey("0123456789abcdef0123456789ABCDEF")).toBe("0123456789abcdef0123456789ABCDEF");
    expect(kakaoJsKey(" 0123456789abcdef0123456789abcdef\n")).toBe("0123456789abcdef0123456789abcdef");
    for (const raw of [
      undefined,
      "",
      "   ",
      "0123456789abcdef",
      "KakaoAK 0123456789abcdef0123456789abcdef",
      "z".repeat(32),
    ]) {
      expect(kakaoJsKey(raw), String(raw)).toBeNull();
    }
  });
});
