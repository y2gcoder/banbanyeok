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
/** 같은 주소(`dv`에 데이터 버전이 들어 있다)는 같은 그림이다. 서버가 못 답한 기본 그림은 곧 다시 시도하게 짧게만 둔다. */
const CACHE_OK = "public, max-age=86400, s-maxage=86400";
const CACHE_FALLBACK = "public, max-age=60";

export async function GET(request: Request) {
  const decoded = decodeShareQuery(new URL(request.url).search);
  const view = decoded.ok ? await loadSharedView(decoded.state) : null;
  const data = decoded.ok && view ? sharedCardData(view, decoded.state) : null;
  const fonts = await ogFonts();
  const body = data ? <SharedCard data={data} /> : <SiteCard />;
  return new ImageResponse(body, { ...size, fonts, headers: { "Cache-Control": data ? CACHE_OK : CACHE_FALLBACK } });
}
