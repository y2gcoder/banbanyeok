import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { StartLink } from "@/components/seo/start-link";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { loadSeoSite } from "@/lib/seo/load";
import { HUB_PATH, hubMetadata } from "@/lib/seo/metadata";
import { groupByStation } from "@/lib/seo/pair-pages";

export function generateMetadata() {
  return hubMetadata();
}

/** 허브: 미리 계산해 둔 인기 조합 전체. 역마다 묶어 상대 역을 고르게 한다. */
export default function HubPage() {
  const { pages } = loadSeoSite();
  const groups = groupByStation(pages);
  const breadcrumbs = breadcrumbJsonLd([
    { name: "반반역", path: "/" },
    { name: "인기 역 조합", path: HUB_PATH },
  ]);
  return (
    <>
      <JsonLd data={breadcrumbs} />
      <section className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-[1.2] font-extrabold tracking-[-0.03em] text-ink">인기 역 조합별 만날 곳</h1>
        <p className="text-[16px] text-ink-soft">
          자주 만나는 역끼리 {pages.length}개 조합을 골랐어요. 각자 지하철 시간으로 계산해서, 가장 오래 걸리는 사람이 덜
          억울한 순서로 3곳을 보여 줘요.
        </p>
      </section>
      {groups.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">아직 준비된 조합이 없어요.</p>
      ) : (
        groups.map(({ station, partners }) => (
          <section key={station.code} aria-labelledby={`hub-${station.code}`} className="flex flex-col gap-2.5">
            <h2 id={`hub-${station.code}`} className="text-lg font-bold text-ink">
              {station.label}에서 출발하면
            </h2>
            <ul className="flex flex-wrap gap-2">
              {partners.map(({ page, partner }) => (
                <li key={page.slug}>
                  <Link
                    href={page.path}
                    className="inline-flex rounded-full border border-rule bg-surface px-3.5 py-2 text-[14px] font-semibold text-ink hover:border-ink"
                  >
                    <span className="sr-only">{station.label}·</span>
                    {partner.name}
                    <span className="sr-only">역 중간 만날 곳</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      <StartLink
        pageKind="hub"
        href="/"
        className="inline-flex h-14 items-center justify-center rounded-xl border-2 border-ink text-[17px] font-bold text-ink"
      >
        다른 역으로 직접 찾아보기
      </StartLink>
    </>
  );
}
