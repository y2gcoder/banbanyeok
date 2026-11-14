import { ImageResponse } from "next/og";
import { SiteCard } from "@/components/og/site-card";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";

// 사이트 기본 미리보기(홈, 그리고 자기 이미지가 없는 페이지). 빌드 때 한 번 만든다.
export const size = { width: OG_WIDTH, height: OG_HEIGHT };
export const contentType = "image/png";
export const alt = "반반역: 우리 어디서 만나야 덜 억울할까?";

export default async function Image() {
  return new ImageResponse(<SiteCard />, { ...size, fonts: await ogFonts() });
}
