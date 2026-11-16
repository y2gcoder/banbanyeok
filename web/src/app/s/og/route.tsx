import { ImageResponse } from "next/og";
import { SharedCard } from "@/components/og/shared-card";
import { SiteCard } from "@/components/og/site-card";
import { decodeShareQuery } from "@/lib/link/codec";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { loadSharedView, sharedCardData } from "@/lib/seo/shared-preview";

// 공유 링크별 미리보기. 링크마다 내용이 달라 요청 때 그린다(조합 페이지와 달리 정적으로 만들 수 없다).
export const dynamic = "force-dynamic";

const size = { width: OG_WIDTH, height: OG_HEIGHT };
/** 같은 주소(`dv`에 데이터 버전이 들어 있다)는 같은 그림이다. 기본 그림은 곧 다시 시도하게 짧게만 둔다. */
const CACHE_OK = "public, max-age=86400, s-maxage=86400";
const CACHE_FALLBACK = "public, max-age=60";
/**
 * 서버 결과 받기 + 그리기 전체의 시간 예산. 넘거나 실패하면 기본 그림으로 간다(크롤러가 오래 기다려 주지 않고, 깨진 그림보다
 * 기본 그림이 낫다). `/s` HTML을 먼저 스크랩하며 서버가 이미 깨어 있으므로 평소에는 이 안에 끝난다.
 */
const RENDER_BUDGET_MS = 1500;

/** 링크의 그림(PNG 바이트). 잘못된 링크·서버 실패면 null. 다 그린 뒤에 돌려주므로 그리기 실패도 여기서 잡힌다. */
async function drawShared(search: string): Promise<ArrayBuffer | null> {
  const decoded = decodeShareQuery(search);
  if (!decoded.ok) return null;
  const view = await loadSharedView(decoded.state);
  const data = view ? sharedCardData(view, decoded.state) : null;
  if (!data) return null;
  return new ImageResponse(<SharedCard data={data} />, { ...size, fonts: await ogFonts() }).arrayBuffer();
}

function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work.catch(() => null), deadline]).finally(() => clearTimeout(timer));
}

export async function GET(request: Request) {
  const bytes = await withinBudget(drawShared(new URL(request.url).search), RENDER_BUDGET_MS);
  if (bytes) {
    return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": CACHE_OK } });
  }
  return new ImageResponse(<SiteCard />, {
    ...size,
    fonts: await ogFonts(),
    headers: { "Cache-Control": CACHE_FALLBACK },
  });
}
