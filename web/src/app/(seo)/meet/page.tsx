import Link from "next/link";
import { JsonLd } from "@/components/seo/json-ld";
import { formatMinutes } from "@/lib/display/minutes";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";
import { loadSeoSite } from "@/lib/seo/load";
import { HUB_PATH, hubMetadata } from "@/lib/seo/metadata";

export function generateMetadata() {
  return hubMetadata(loadSeoSite().source === "artifact");
}

/** 허브: 미리 계산해 둔 인기 조합 전체 목록. */
export default function HubPage() {
  const { pages } = loadSeoSite();
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
          자주 만나는 두 역을 골랐어요. 각자 지하철 시간으로 계산해서, 가장 오래 걸리는 사람이 덜 억울한 순서로 3곳을
          보여 줘요.
        </p>
      </section>
      {pages.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">아직 준비된 조합이 없어요.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {pages.map((page) => {
            const top = page.candidates[0];
            return (
              <li key={page.slug}>
                <Link
                  href={page.path}
                  className="flex h-full flex-col gap-1 rounded-xl border border-rule bg-surface px-4 py-3.5 hover:border-ink"
                >
                  <span className="text-[17px] font-bold text-ink">
                    {page.first.label} · {page.second.label}
                  </span>
                  {top ? (
                    <span className="tabular text-[13px] text-muted-foreground">
                      1위 {top.station.label}, 최장 {formatMinutes(top.aggregate.max)}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Link
        href="/"
        className="inline-flex h-14 items-center justify-center rounded-xl border-2 border-ink text-[17px] font-bold text-ink"
      >
        다른 역으로 직접 찾아보기
      </Link>
    </>
  );
}
