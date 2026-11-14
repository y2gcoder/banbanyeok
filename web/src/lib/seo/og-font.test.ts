import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ogFonts } from "./og-font";
import { OG_FONT_FAMILY, OG_FONT_FILE } from "./og-text";

const fonts = resolve(import.meta.dirname, "../../../public/fonts");

describe("OG 글꼴 파일과 라이선스", () => {
  const font = readFileSync(resolve(fonts, OG_FONT_FILE));

  it("서브셋이다(전체 글꼴 수 MB가 아니다)", () => {
    expect(font.length).toBeLessThan(500_000);
    expect(font.subarray(0, 4).toString("latin1")).toBe("OTTO");
  });

  it("OFL 예약 이름(Pretendard)을 쓰지 않고 새 이름을 갖는다", () => {
    for (const needle of [Buffer.from("Pretendard", "latin1"), Buffer.from("Pretendard", "utf16le").swap16()]) {
      expect(font.includes(needle)).toBe(false);
    }
    expect(font.includes(Buffer.from(OG_FONT_FAMILY, "utf16le").swap16())).toBe(true);
  });

  it("라이선스 전문과 저작권 표기를 함께 둔다", () => {
    const license = readFileSync(resolve(fonts, "OFL.txt"), "utf8");
    expect(license).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(license).toContain("Kil Hyung-jin");
    expect(license).toContain("Reserved Font Name");
  });

  it("ImageResponse용 글꼴 옵션: 이름·굵기와 같은 바이트", async () => {
    const [entry] = await ogFonts();
    expect(entry?.name).toBe(OG_FONT_FAMILY);
    expect(entry?.weight).toBe(700);
    expect(Buffer.from(entry?.data ?? new ArrayBuffer(0)).equals(font)).toBe(true);
  });
});
