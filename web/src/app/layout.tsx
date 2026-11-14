import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/common/site-footer";
import { PLATFORM_COLOR } from "@/lib/seo/app-manifest";
import { siteMetadata } from "@/lib/seo/metadata";
import { Providers } from "./providers";
import "./globals.css";

// 사이트 기본 메타(title 템플릿, 설명, metadataBase, Open Graph, Twitter). 주소는 SITE_URL에서 읽는다(src/lib/seo/site.ts).
export function generateMetadata(): Metadata {
  return siteMetadata();
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 노치·펀치홀·둥근 모서리 밖까지 그린다. 대신 본문 여백(px-gutter)과 맨 아래(pb-safe)가 안전 영역(env(safe-area-inset-*))을 띄운다.
  viewportFit: "cover",
  // 주소창·상태 표시줄 색. 화면이 밝은 모드 하나라 기기의 밝은/어두운 설정과 상관없이 한 색이다(src/lib/seo/app-manifest.ts).
  themeColor: PLATFORM_COLOR,
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
        <SiteFooter />
      </body>
    </html>
  );
}
