import { notFound } from "next/navigation";
import { ImageResponse } from "next/og";
import { PairCard } from "@/components/og/pair-card";
import { loadSeoSite } from "@/lib/seo/load";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { findPairPage } from "@/lib/seo/pair-pages";

// 조합 페이지의 미리보기는 **빌드 때** 정적으로 만든다(요청 때 그리면 Cloudflare 무료 플랜의 CPU 10ms를 넘길 수 있다).
export const dynamicParams = false;
export const size = { width: OG_WIDTH, height: OG_HEIGHT };
export const contentType = "image/png";
export const alt = "반반역: 두 역 사이에서 공평하게 만날 곳 후보 3곳";

export function generateStaticParams() {
  return loadSeoSite().pages.map((page) => ({ pair: page.slug }));
}

export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const page = findPairPage(loadSeoSite().pages, (await params).pair);
  if (!page) notFound();
  return new ImageResponse(<PairCard page={page} />, { ...size, fonts: await ogFonts() });
}
