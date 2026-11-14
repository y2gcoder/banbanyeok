import type { ReactNode } from "react";
import { Wordmark } from "@/components/common/wordmark";
import { DataBasis } from "@/components/seo/data-basis";
import { loadSeoSite } from "@/lib/seo/load";

/** SEO 페이지(허브·조합)의 공통 틀: 워드마크, 본문, 데이터 기준 안내. 정적으로 만든다. */
export default function SeoLayout({ children }: { children: ReactNode }) {
  const site = loadSeoSite();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 pt-5 pb-10">
      <header>
        <Wordmark />
      </header>
      <main className="flex flex-1 flex-col gap-6 pt-6">{children}</main>
      <DataBasis dataVersion={site.dataVersion} isSample={site.source === "fixture"} />
    </div>
  );
}
