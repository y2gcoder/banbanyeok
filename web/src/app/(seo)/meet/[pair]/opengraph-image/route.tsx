import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { PairCard } from "@/components/og/pair-card";
import { loadSeoSite } from "@/lib/seo/load";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { findPairPage } from "@/lib/seo/pair-pages";

// 조합 페이지의 미리보기는 **빌드 때** 정적으로 만든다(요청 때 그리면 Cloudflare 무료 플랜의 CPU 10ms를 넘길 수 있다).
// 파일 규약(opengraph-image.tsx)이 아니라 라우트로 둔 이유는 사이트 기본 그림(`app/opengraph-image/route.tsx`)과 같다:
// 규약의 주소 해시는 이 파일의 소스만 반영한다. 주소의 `?v=`는 `pairOgImagePath`가 그림 입력과 조합 데이터로 만들고, 여기서는 읽지 않는다.
export const dynamicParams = false;
export const dynamic = "force-static";

type Context = { params: Promise<{ pair: string }> };

export function generateStaticParams() {
  return loadSeoSite().pages.map((page) => ({ pair: page.slug }));
}

export async function GET(_request: Request, { params }: Context) {
  const page = findPairPage(loadSeoSite().pages, (await params).pair);
  if (!page) notFound();
  return new ImageResponse(<PairCard page={page} />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: await ogFonts(),
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
