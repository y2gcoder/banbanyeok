import type { ReactNode } from "react";
import { Wordmark } from "@/components/common/wordmark";
import { DataBasis } from "@/components/seo/data-basis";
import { loadSeoSite } from "@/lib/seo/load";

/** SEO 페이지(허브·조합)의 공통 틀: 워드마크, 본문, 데이터 기준 안내. 정적으로 만든다. 두 칸 폭(wide)부터는 넓게 쓰고 목록·카드를 여러 칸으로 놓는다. */
export default function SeoLayout({ children }: { children: ReactNode }) {
  const site = loadSeoSite();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-gutter pt-5 pb-10 wide:max-w-6xl">
      <header>
        <Wordmark />
      </header>
      <main className="flex flex-1 flex-col gap-6 pt-6">{children}</main>
      <DataBasis dataVersion={site.dataVersion} />
    </div>
  );
}
