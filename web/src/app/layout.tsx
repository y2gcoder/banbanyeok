import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/common/site-footer";
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
  themeColor: "#eef1f0",
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
