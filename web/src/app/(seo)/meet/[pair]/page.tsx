import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/seo/json-ld";
import { PairCandidateCard } from "@/components/seo/pair-candidate";
import { prefillHref } from "@/lib/form/prefill";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { loadSeoSite } from "@/lib/seo/load";
import { HUB_PATH, pairMetadata } from "@/lib/seo/metadata";
import { findPairPage, relatedPages } from "@/lib/seo/pair-pages";

type Props = { params: Promise<{ pair: string }> };

// 미리 만든 조합만 연다. 그 밖의 주소는 404(런타임에 데이터 파일을 읽지 않는다: Workers에는 파일이 없다).
export const dynamicParams = false;

export function generateStaticParams() {
  return loadSeoSite().pages.map((page) => ({ pair: page.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const site = loadSeoSite();
  const page = findPairPage(site.pages, (await params).pair);
  return page ? pairMetadata(page, site.source === "artifact") : {};
}

export default async function PairPage({ params }: Props) {
  const site = loadSeoSite();
  const page = findPairPage(site.pages, (await params).pair);
  if (!page) notFound();
  const breadcrumbs = breadcrumbJsonLd([
    { name: "반반역", path: "/" },
    { name: "인기 역 조합", path: HUB_PATH },
    { name: `${page.first.name}·${page.second.name}`, path: page.path },
  ]);
  const related = relatedPages(site.pages, page);
  return (
    <>
      <JsonLd data={breadcrumbs} />
      <nav aria-label="현재 위치" className="text-[13px] text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-ink">
              반반역
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link href={HUB_PATH} className="hover:text-ink">
              인기 역 조합
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="font-semibold text-ink">
            {page.first.name}·{page.second.name}
          </li>
        </ol>
      </nav>
      <section className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-[1.2] font-extrabold tracking-[-0.03em] text-ink">
          {page.first.label}·{page.second.label}
          <br />
          중간 만날 곳 추천
        </h1>
        <p className="text-[16px] text-ink-soft">
          {page.first.name}에서 출발하는 사람과 {page.second.name}에서 출발하는 사람이 지하철로 가장 공평하게 만나는 곳{" "}
          {page.candidates.length}곳이에요. 시간은 각자 걸리는 분이에요.
        </p>
      </section>
      <ol aria-label="추천 후보" className="flex flex-col gap-4">
        {page.candidates.map((candidate) => (
          <PairCandidateCard key={candidate.rank} candidate={candidate} />
        ))}
      </ol>
      <Link
        href={prefillHref([page.first.code, page.second.code])}
        className="inline-flex h-14 items-center justify-center rounded-xl border-2 border-ink text-[17px] font-bold text-ink"
      >
        다른 역으로 다시 찾기
      </Link>
      {related.length > 0 ? (
        <section aria-labelledby="related-title" className="flex flex-col gap-3">
          <h2 id="related-title" className="text-lg font-bold text-ink">
            이 역이 들어간 다른 조합
          </h2>
          <ul className="flex flex-wrap gap-2">
            {related.map((item) => (
              <li key={item.slug}>
                <Link
                  href={item.path}
                  className="inline-flex rounded-full border border-rule bg-surface px-3.5 py-2 text-[14px] font-semibold text-ink hover:border-ink"
                >
                  {item.first.name} · {item.second.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
