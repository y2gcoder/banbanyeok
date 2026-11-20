import { ImageResponse } from "next/og";
import { SiteCard } from "@/components/og/site-card";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/copy/og-text";
import { ogFonts } from "@/lib/seo/og-font";

// 사이트 기본 미리보기(홈, 그리고 자기 이미지가 없는 페이지). 빌드 때 한 번 만든다.
// 파일 규약(opengraph-image.tsx)이 아니라 라우트로 둔 이유: 규약은 og:image 주소에 이 파일 내용의 해시만 붙여서,
// 문구·색·글꼴이 바뀌어도 주소가 그대로다. 라우트로 두면 모든 곳이 `SITE_OG_IMAGE_PATH`(그림 입력으로 만든 `?v=`) 하나를 쓴다.
// 쿼리는 읽지 않는다(`?v=`가 무엇이든 같은 그림).
export const dynamic = "force-static";

export async function GET() {
  return new ImageResponse(<SiteCard />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: await ogFonts(),
    headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}
