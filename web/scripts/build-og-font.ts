/**
 * 미리보기(OG) 이미지용 한국어 글꼴 서브셋을 만든다.
 *
 * 입력: 의존성 `pretendard`의 Bold(OTF, OFL 1.1), 파이프라인의 `og-glyphs.txt`(역 이름 글자), 웹 역 인덱스의 이름,
 *       `src/lib/seo/og-text.ts`의 고정 문구, ASCII 출력 가능 문자, KS X 1001 한글 2,350자(별칭에 쓰일 흔한 글자).
 * 출력: public/fonts/og-sans-bold.otf, public/fonts/OFL.txt, src/lib/seo/og-glyphs.gen.json(글꼴에 실제로 들어간 글자)
 *
 * 라이선스: Pretendard는 OFL 1.1이며 "Reserved Font Name: Pretendard"다. 서브셋은 수정본이라 그 이름을 쓸 수 없으므로
 * 글꼴 안의 이름(name 표, CFF 이름·문자열)을 `BanbanSans`로 바꾸고, 원 저작권 표기와 라이선스 전문(OFL.txt)을 같이 둔다.
 * 결과에 `Pretendard`가 한 글자라도 남으면 실패한다.
 *
 * 사용: pnpm gen:og-font  (결정적이다. CI `check:contracts`가 재생성 후 git diff로 확인한다)
 * 환경 변수: OG_GLYPHS_FILE(기본 ../data/artifacts/dev/og-glyphs.txt)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";
import { OG_FONT_FAMILY, OG_FONT_FILE, ogFixedChars } from "../src/lib/seo/og-text.ts";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const glyphsFile = resolve(web, process.env.OG_GLYPHS_FILE ?? "../data/artifacts/dev/og-glyphs.txt");
const pretendard = resolve(web, "node_modules/pretendard/dist");
const SOURCE_FONT = resolve(pretendard, "public/static/Pretendard-Bold.otf");

// ---------- 글자 모으기 ----------

function asciiPrintable(): string {
  let text = "";
  for (let code = 0x20; code < 0x7f; code += 1) text += String.fromCharCode(code);
  return text;
}

/** KS X 1001 한글 완성형 2,350자(EUC-KR 0xB0A1~0xC8FE). */
function ksx1001Hangul(): string {
  const decoder = new TextDecoder("euc-kr");
  let text = "";
  for (let hi = 0xb0; hi <= 0xc8; hi += 1) {
    for (let lo = 0xa1; lo <= 0xfe; lo += 1) {
      const ch = decoder.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch >= "가" && ch <= "힣") text += ch;
    }
  }
  return text;
}

function stationNameChars(): string {
  const index = JSON.parse(readFileSync(resolve(web, "src/lib/stations/index.gen.json"), "utf8")) as {
    stations: [string, string, ...unknown[]][];
  };
  return index.stations.map((s) => s[1]).join("");
}

// ---------- sfnt 읽기·쓰기(이름 바꾸기용) ----------

type Table = { tag: string; data: Buffer };

function readTables(font: Buffer): { version: number; tables: Table[] } {
  const count = font.readUInt16BE(4);
  const tables: Table[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 12 + 16 * i;
    const offset = font.readUInt32BE(entry + 8);
    const length = font.readUInt32BE(entry + 12);
    tables.push({
      tag: font.toString("ascii", entry, entry + 4),
      data: Buffer.from(font.subarray(offset, offset + length)),
    });
  }
  return { version: font.readUInt32BE(0), tables };
}

function checksum(data: Buffer): number {
  const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + padded.readUInt32BE(i)) >>> 0;
  return sum;
}

function writeSfnt(version: number, tables: Table[]): Buffer {
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));
  const count = sorted.length;
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = 16 * 2 ** entrySelector;
  const header = Buffer.alloc(12 + 16 * count);
  header.writeUInt32BE(version, 0);
  header.writeUInt16BE(count, 4);
  header.writeUInt16BE(searchRange, 6);
  header.writeUInt16BE(entrySelector, 8);
  header.writeUInt16BE(16 * count - searchRange, 10);
  const bodies: Buffer[] = [];
  let offset = header.length;
  let headOffset = -1;
  sorted.forEach((table, i) => {
    if (table.tag === "head") {
      table.data.writeUInt32BE(0, 8); // checkSumAdjustment를 0으로 두고 계산한다
      headOffset = offset;
    }
    const entry = 12 + 16 * i;
    header.write(table.tag, entry, "ascii");
    header.writeUInt32BE(checksum(table.data), entry + 4);
    header.writeUInt32BE(offset, entry + 8);
    header.writeUInt32BE(table.data.length, entry + 12);
    const padded = Buffer.concat([table.data, Buffer.alloc((4 - (table.data.length % 4)) % 4)]);
    bodies.push(padded);
    offset += padded.length;
  });
  const file = Buffer.concat([header, ...bodies]);
  if (headOffset >= 0) file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headOffset + 8);
  return file;
}

function nameTable(records: [number, string][]): Buffer {
  const strings = records.map(([, text]) => Buffer.from(text, "utf16le").swap16());
  const storageOffset = 6 + 12 * records.length;
  const head = Buffer.alloc(storageOffset);
  head.writeUInt16BE(0, 0); // format 0
  head.writeUInt16BE(records.length, 2);
  head.writeUInt16BE(storageOffset, 4);
  let offset = 0;
  records.forEach(([id], i) => {
    const at = 6 + 12 * i;
    head.writeUInt16BE(3, at); // platform: Windows
    head.writeUInt16BE(1, at + 2); // encoding: Unicode BMP
    head.writeUInt16BE(0x0409, at + 4); // language: en-US
    head.writeUInt16BE(id, at + 6);
    const length = strings[i]?.length ?? 0;
    head.writeUInt16BE(length, at + 8);
    head.writeUInt16BE(offset, at + 10);
    offset += length;
  });
  return Buffer.concat([head, ...strings]);
}

/** 같은 길이의 바이트열로 바꾼다(CFF 이름·문자열 INDEX 오프셋이 그대로라 안전하다). */
function replaceSameLength(data: Buffer, from: string, to: string): void {
  if (from.length !== to.length) throw new Error(`길이가 다릅니다: ${from} → ${to}`);
  const needle = Buffer.from(from, "latin1");
  const next = Buffer.from(to, "latin1");
  for (let at = data.indexOf(needle); at >= 0; at = data.indexOf(needle, at + next.length)) next.copy(data, at);
}

function rename(font: Buffer): Buffer {
  const { version, tables } = readTables(font);
  const family = OG_FONT_FAMILY;
  const style = "Bold";
  const replaced = tables.map((table): Table => {
    if (table.tag === "name") {
      return {
        tag: "name",
        data: nameTable([
          [0, "Copyright (c) 2023 Kil Hyung-jin"],
          [1, family],
          [2, style],
          [3, `${family}-${style};og-subset`],
          [4, `${family} ${style}`],
          [5, "Version 1.0; OG subset"],
          [6, `${family}-${style}`],
          [13, "This Font Software is licensed under the SIL Open Font License, Version 1.1."],
          [14, "https://openfontlicense.org"],
        ]),
      };
    }
    if (table.tag === "CFF ") {
      // 이 글꼴의 원래 이름(Pretendard)은 OFL 예약 이름이라 쓰지 않는다. 길이가 같은 이름으로 바꾼다.
      const data = Buffer.from(table.data);
      // CFF 저작권 고지에는 "Pretendard is a trademark of …" 문장이 있다. 이름만 바꾸면 우리 이름이 상표처럼 읽히니 먼저 푼다.
      replaceSameLength(data, "Pretendard is a trademark", "Orig. font is a trademark");
      replaceSameLength(data, "Pretendard-Bold", `${family}-${style}`);
      replaceSameLength(data, "Pretendard Bold", `${family} ${style}`);
      replaceSameLength(data, "Pretendard", family);
      return { tag: table.tag, data };
    }
    return table;
  });
  return writeSfnt(version, replaced);
}

/** cmap(형식 4·12)에서 글꼴이 실제로 가진 글자. */
function cmapChars(font: Buffer): Set<string> {
  const { tables } = readTables(font);
  const cmap = tables.find((t) => t.tag === "cmap")?.data;
  if (!cmap) throw new Error("cmap이 없습니다");
  const chars = new Set<string>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i += 1) {
    const offset = cmap.readUInt32BE(4 + 8 * i + 4);
    const format = cmap.readUInt16BE(offset);
    if (format === 12) {
      const groups = cmap.readUInt32BE(offset + 12);
      for (let g = 0; g < groups; g += 1) {
        const at = offset + 16 + 12 * g;
        for (let code = cmap.readUInt32BE(at); code <= cmap.readUInt32BE(at + 4); code += 1) {
          chars.add(String.fromCodePoint(code));
        }
      }
    } else if (format === 4) {
      const segments = cmap.readUInt16BE(offset + 6) / 2;
      const endCodes = offset + 14;
      const startCodes = endCodes + 2 * segments + 2;
      for (let s = 0; s < segments; s += 1) {
        const end = cmap.readUInt16BE(endCodes + 2 * s);
        for (let code = cmap.readUInt16BE(startCodes + 2 * s); code <= end && code !== 0xffff; code += 1) {
          chars.add(String.fromCodePoint(code));
        }
      }
    }
  }
  chars.delete("\u0000");
  return chars;
}

// ---------- 실행 ----------

const requested = [
  asciiPrintable(),
  ksx1001Hangul(),
  stationNameChars(),
  readFileSync(glyphsFile, "utf8"),
  ogFixedChars().join(""),
].join("");
const wanted = new Set(Array.from(requested).filter((ch) => ch === " " || ch.trim() !== ""));
const text = [...wanted].sort().join("");

const subset = await subsetFont(readFileSync(SOURCE_FONT), text, { targetFormat: "sfnt" });
const output = rename(subset);

const reserved = [Buffer.from("Pretendard", "latin1"), Buffer.from("Pretendard", "utf16le").swap16()];
if (reserved.some((needle) => output.includes(needle)))
  throw new Error("결과 글꼴에 예약 이름 Pretendard가 남아 있습니다");

const present = cmapChars(output);
const missingFixed = ogFixedChars().filter((ch) => !present.has(ch));
if (missingFixed.length > 0) throw new Error(`고정 문구 글자가 글꼴에 없습니다: ${missingFixed.join("")}`);
const chars = [...wanted]
  .filter((ch) => present.has(ch))
  .sort()
  .join("");

const fonts = resolve(web, "public/fonts");
writeFileSync(resolve(fonts, OG_FONT_FILE), output);
writeFileSync(
  resolve(fonts, "OFL.txt"),
  [
    `${OG_FONT_FILE}: Pretendard Bold(https://github.com/orioncactus/pretendard)를 서브셋하고 이름을 ${OG_FONT_FAMILY}로 바꾼 수정본입니다.`,
    "OFL 1.1 3항에 따라 예약 글꼴 이름(Pretendard)은 쓰지 않았고, 아래 원 저작권 표기와 라이선스 전문을 함께 둡니다.",
    "만드는 법: web/scripts/build-og-font.ts",
    "",
    readFileSync(resolve(pretendard, "LICENSE.txt"), "utf8").trimEnd(),
    "",
  ].join("\n"),
);
writeFileSync(resolve(web, "src/lib/seo/og-glyphs.gen.json"), `${JSON.stringify({ chars }, null, 2)}\n`);
const sha = createHash("sha256").update(output).digest("hex").slice(0, 12);
process.stdout.write(`og font: ${output.length} bytes, ${[...chars].length} glyphs, sha256:${sha}\n`);
