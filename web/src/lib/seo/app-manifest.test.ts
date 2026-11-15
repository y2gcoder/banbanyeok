import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_NAME, appManifest, PLATFORM_COLOR } from "./app-manifest";

const web = resolve(import.meta.dirname, "../../..");

/** PNG 머리(IHDR)의 가로·세로. */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("웹 앱 매니페스트", () => {
  it("이름·시작 주소·표시 방식·색이 정해진 값이다", () => {
    const m = appManifest();
    expect(m).toMatchObject({
      name: APP_NAME,
      short_name: APP_NAME,
      start_url: "/",
      scope: "/",
      display: "standalone",
      lang: "ko",
      theme_color: PLATFORM_COLOR,
      background_color: PLATFORM_COLOR,
    });
  });

  it("테마 색은 globals.css의 --platform 토큰과 같다", () => {
    const css = readFileSync(resolve(web, "src/app/globals.css"), "utf8");
    expect(/--platform:\s*(#[0-9a-f]{6})/i.exec(css)?.[1]).toBe(PLATFORM_COLOR);
  });

  it("아이콘 192·512(any, maskable) 파일이 있고 크기가 맞다", () => {
    const icons = appManifest().icons ?? [];
    expect(icons.map((i) => `${i.purpose} ${i.sizes}`)).toEqual([
      "any 192x192",
      "any 512x512",
      "maskable 192x192",
      "maskable 512x512",
    ]);
    for (const icon of icons) {
      const size = Number(icon.sizes?.split("x")[0]);
      expect(pngSize(readFileSync(resolve(web, "public", icon.src.slice(1)))), icon.src).toEqual([size, size]);
    }
  });
});

describe("앱 아이콘 파일(scripts/build-icons.ts가 만든 것)", () => {
  it("apple-icon.png는 180×180", () => {
    expect(pngSize(readFileSync(resolve(web, "src/app/apple-icon.png")))).toEqual([180, 180]);
  });

  it("favicon.ico는 16·32·48 PNG를 담은 ICO다", () => {
    const ico = readFileSync(resolve(web, "src/app/favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + 16 * i;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const [w, h] = pngSize(ico.subarray(offset, offset + length));
      expect(w).toBe(ico.readUInt8(entry));
      expect(h).toBe(w);
      sizes.push(w);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });

  it("icon.svg는 토큰 색만 쓴다", () => {
    const svg = readFileSync(resolve(web, "src/app/icon.svg"), "utf8");
    const colors = new Set(svg.match(/#[0-9a-f]{6}/gi));
    expect([...colors].every((c) => ["#16201b", "#ffffff", "#eef1f0", "#f5c518"].includes(c.toLowerCase()))).toBe(true);
  });
});
