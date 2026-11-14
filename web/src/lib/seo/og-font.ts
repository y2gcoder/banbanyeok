/**
 * OG 이미지용 글꼴 바이트. 환경마다 읽는 곳이 다르다.
 *
 * - Cloudflare Workers(OpenNext): 글꼴은 Workers Static Assets(`public/fonts`)에 있고 `ASSETS` 바인딩으로 읽는다
 *   (같은 Worker 안의 호출이라 외부 요청이 아니다).
 * - Node(빌드 때 정적 생성, `next dev`/`next start`): `public/fonts`를 파일로 읽는다.
 *
 * 한 번 읽으면 같은 isolate/프로세스 안에서 재사용한다(349KB).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { OG_FONT_FAMILY, OG_FONT_FILE } from "./og-text";

type AssetsBinding = { fetch(request: Request): Promise<Response> };

let cached: Promise<ArrayBuffer> | null = null;

async function fromWorkerAssets(): Promise<ArrayBuffer | null> {
  let assets: AssetsBinding | undefined;
  try {
    assets = (getCloudflareContext().env as { ASSETS?: AssetsBinding }).ASSETS;
  } catch {
    return null; // Workers 밖(Node)이다.
  }
  if (!assets) return null;
  const response = await assets.fetch(new Request(`https://assets.invalid/fonts/${OG_FONT_FILE}`));
  return response.ok ? response.arrayBuffer() : null;
}

async function fromFile(): Promise<ArrayBuffer> {
  const bytes = await readFile(join(process.cwd(), "public/fonts", OG_FONT_FILE));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function loadOgFontData(): Promise<ArrayBuffer> {
  cached ??= fromWorkerAssets()
    .then((data) => data ?? fromFile())
    .catch((error: unknown) => {
      cached = null; // 실패를 고정하지 않는다.
      throw error;
    });
  return cached;
}

/** `ImageResponse`의 `fonts` 옵션. */
export async function ogFonts() {
  return [{ name: OG_FONT_FAMILY, data: await loadOgFontData(), weight: 700 as const, style: "normal" as const }];
}
