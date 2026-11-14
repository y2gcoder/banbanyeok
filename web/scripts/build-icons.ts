/**
 * 앱 아이콘을 SVG 원본(assets/icons/mark-*.svg)에서 만든다. 새 의존성 없이 Playwright의 크로미움(개발 의존성)으로 그린다.
 *
 * 출력(커밋한다. 렌더러·OS마다 픽셀이 조금 달라 CI의 재생성 diff 검사에는 넣지 않는다. 크기·형식은 icons.test.ts가 확인한다):
 *   src/app/favicon.ico          16·32·48 PNG를 담은 ICO(브라우저 탭, `/favicon.ico`를 직접 찾는 클라이언트)
 *   src/app/icon.svg             탭 아이콘 SVG(크기 무관, 최신 브라우저)
 *   src/app/apple-icon.png       180×180, 꽉 찬 사각형(iOS 홈 화면이 모서리를 자른다)
 *   public/icons/icon-{192,512}.png       manifest purpose "any"
 *   public/icons/maskable-{192,512}.png   manifest purpose "maskable"(마크가 가운데 지름 80% 안전 영역 안)
 *
 * 사용: pnpm gen:icons                 적용 시안(ICON_VARIANT, 기본 c)으로 위 파일을 만든다
 *       pnpm gen:icons --preview       시안 비교 이미지 docs/setup/u1-screens/icon-{a,b,c}.png
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, chromium } from "@playwright/test";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VARIANTS = {
  a: { file: "mark-a-platform.svg", label: "A · 승강장 회색 바탕" },
  b: { file: "mark-b-ink.svg", label: "B · 잉크 바탕 + 안전선 노랑" },
  c: { file: "mark-c-safety.svg", label: "C · 안전선 노랑 바탕" },
} as const;
type Variant = keyof typeof VARIANTS;

/** 원본에서 바탕색과 마크(<g id="mark">)를 꺼낸다. */
function readVariant(variant: Variant): { bg: string; mark: string } {
  const text = readFileSync(resolve(web, "assets/icons", VARIANTS[variant].file), "utf8");
  const bg = /<rect id="bg"[^>]*fill="([^"]+)"/.exec(text)?.[1];
  const mark = /<g id="mark">[\s\S]*?<\/g>/.exec(text)?.[0];
  if (!bg || !mark) throw new Error(`${VARIANTS[variant].file}: <rect id="bg">와 <g id="mark">가 필요합니다`);
  return { bg, mark };
}

/**
 * 용도별 SVG. 마크의 바깥 반지름은 원본에서 164 + 56/2 = 192(512 기준).
 * - tab: 둥근 사각형, 마크 그대로(지름 75%) — 16px에서도 알아보게 크게
 * - full: 꽉 찬 사각형, 마크 90%
 * - maskable: 꽉 찬 사각형, 마크 76%(바깥 반지름 146 < 안전 영역 반지름 204.8)
 */
type Shape = "tab" | "full" | "maskable";
const SCALE: Record<Shape, number> = { tab: 1, full: 0.9, maskable: 0.76 };

function compose(variant: Variant, shape: Shape): string {
  const { bg, mark } = readVariant(variant);
  const rx = shape === "tab" ? ' rx="112"' : "";
  const s = SCALE[shape];
  const body = s === 1 ? mark : `<g transform="translate(256 256) scale(${s}) translate(-256 -256)">${mark}</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>반반역</title><rect width="512" height="512"${rx} fill="${bg}"/>${body}</svg>\n`;
}

async function renderPng(browser: Browser, svg: string, size: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const sized = svg.replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return png;
}

/** PNG를 그대로 담는 ICO(Windows Vista 이후·모든 최신 브라우저가 읽는다). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = 아이콘
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // 팔레트 없음
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4); // 색 평면
    entry.writeUInt16LE(32, 6); // 픽셀당 비트
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

function write(path: string, data: Buffer | string) {
  const full = resolve(web, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  process.stdout.write(`  ${path} (${typeof data === "string" ? Buffer.byteLength(data) : data.length} B)\n`);
}

async function build(browser: Browser, variant: Variant) {
  process.stdout.write(`아이콘 만들기: 시안 ${variant.toUpperCase()}\n`);
  const tab = compose(variant, "tab");
  write("src/app/icon.svg", tab);
  const tabs = await Promise.all(
    [16, 32, 48].map(async (size) => ({ size, png: await renderPng(browser, tab, size) })),
  );
  write("src/app/favicon.ico", ico(tabs));
  write("src/app/apple-icon.png", await renderPng(browser, compose(variant, "full"), 180));
  for (const size of [192, 512]) {
    write(`public/icons/icon-${size}.png`, await renderPng(browser, compose(variant, "full"), size));
    write(`public/icons/maskable-${size}.png`, await renderPng(browser, compose(variant, "maskable"), size));
  }
}

/** 시안 비교: 실제 픽셀 크기(16·32·48) 탭 모양(밝은/어두운 탭 막대), 홈 화면(iOS 둥근 사각형·안드로이드 원형 마스크). */
async function preview(browser: Browser) {
  for (const variant of Object.keys(VARIANTS) as Variant[]) {
    const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const png = async (svg: string, size: number) =>
      `data:image/png;base64,${(await renderPng(browser, svg, size)).toString("base64")}`;
    const tab = compose(variant, "tab");
    const small = await Promise.all([16, 32, 48].map((s) => png(tab, s)));
    const tabBar = (bg: string, fg: string) =>
      `<div style="display:flex;gap:16px;align-items:center;background:${bg};color:${fg};padding:10px 14px;border-radius:10px">${[
        16, 32, 48,
      ]
        .map(
          (s, i) =>
            `<span style="display:flex;align-items:center;gap:6px"><img src="${small[i]}" width="${s}" height="${s}" style="image-rendering:pixelated"><span style="font-size:12px">${s}px</span></span>`,
        )
        .join("")}<span style="font-size:13px">반반역 — 탭</span></div>`;
    const home = `
      <div style="display:flex;gap:24px;align-items:end">
        <figure style="margin:0;text-align:center"><img src="${uri(compose(variant, "full"))}" width="120" height="120" style="border-radius:27px"><figcaption>iOS 홈(180)</figcaption></figure>
        <figure style="margin:0;text-align:center"><img src="${uri(compose(variant, "maskable"))}" width="120" height="120" style="border-radius:50%"><figcaption>안드로이드 원형 마스크</figcaption></figure>
        <figure style="margin:0;text-align:center"><img src="${uri(compose(variant, "maskable"))}" width="120" height="120" style="border-radius:30px"><figcaption>안드로이드 둥근 사각</figcaption></figure>
      </div>`;
    const page = await browser.newPage({ viewport: { width: 640, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;padding:20px;background:#fff;font-family:-apple-system,'Apple SD Gothic Neo',sans-serif;display:flex;flex-direction:column;gap:16px">
      <h1 style="margin:0;font-size:18px">${VARIANTS[variant].label}</h1>
      ${tabBar("#dee1e6", "#202124")}${tabBar("#202124", "#e8eaed")}${home}</body></html>`);
    const out = resolve(web, `../docs/setup/u1-screens/icon-${variant}.png`);
    mkdirSync(dirname(out), { recursive: true });
    await page.screenshot({ path: out, fullPage: true });
    await page.close();
    process.stdout.write(`  ${out.slice(resolve(web, "..").length + 1)}\n`);
  }
}

const browser = await chromium.launch();
try {
  if (process.argv.includes("--preview")) await preview(browser);
  else {
    const variant = (process.env.ICON_VARIANT ?? "c") as Variant;
    if (!(variant in VARIANTS)) throw new Error(`ICON_VARIANT는 a, b, c 중 하나: ${variant}`);
    await build(browser, variant);
  }
} finally {
  await browser.close();
}
