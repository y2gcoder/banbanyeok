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
