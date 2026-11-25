import type { Metadata } from "next";
import Link from "next/link";
import { SearchLockSection } from "./_draft/search-lock";
import { BadgeSection, CopySection, CoverageSection, ErrorCopySection, ScheduleGateSection } from "./_draft/sections";

export const metadata: Metadata = { title: "부산권 화면 시안", robots: { index: false, follow: false } };

const SECTIONS = [
  { n: 1, label: "역 검색·권역 잠금" },
  { n: 2, label: "지원 노선 안내" },
  { n: 3, label: "'수도권' 표현" },
  { n: 4, label: "오류 문구" },
  { n: 5, label: "요일 미지원 역 참여" },
  { n: 6, label: "노선 색·배지" },
] as const;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** 운영자 검토용 부산권 화면 시안(#180 5단계). `next dev`에서만 라우트가 된다(next.config.ts pageExtensions). `?s=1`~`6`이면 그 항목만. */
export default async function BusanDraftPage({ searchParams }: Props) {
  const raw = (await searchParams).s;
  const only = Number(Array.isArray(raw) ? raw[0] : raw);
  const show = (n: number) => !SECTIONS.some((s) => s.n === only) || only === n;
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-10 px-gutter pt-5 pb-10">
      <header className="flex flex-col gap-3">
        <p className="w-fit rounded-md bg-safety px-2 py-0.5 text-[12px] font-bold text-safety-ink">
          개발 전용 시안 · 운영 빌드에는 없어요
        </p>
        <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-ink">부산권 화면 시안</h1>
        <p className="max-w-3xl text-[15px] text-ink-soft">
          #180 5단계. 갈리는 곳마다 안을 나란히 놓았어요. 문구와 공개 범위는 운영자가 정해요. 부산 역은 개발 산출물에서
          뽑은 픽스처이고, 이동 시간은 보여 주지 않아요. 막차는 이번 범위 밖이라 끈 상태로 둬요.
        </p>
        <nav aria-label="시안 항목" className="flex flex-wrap gap-2 text-[14px]">
          <Link href="/drafts/busan" className="rounded-md border border-rule bg-surface px-2 py-1 font-semibold">
            전체
          </Link>
          {SECTIONS.map((s) => (
            <Link
              key={s.n}
              href={`/drafts/busan?s=${s.n}`}
              aria-current={only === s.n ? "page" : undefined}
              className="rounded-md border border-rule bg-surface px-2 py-1 aria-[current=page]:border-ink aria-[current=page]:font-bold"
            >
              {s.n}. {s.label}
            </Link>
          ))}
        </nav>
      </header>
      {show(1) ? <SearchLockSection style="pill" /> : null}
      {show(2) ? <CoverageSection style="pill" /> : null}
      {show(3) ? <CopySection /> : null}
      {show(4) ? <ErrorCopySection /> : null}
      {show(5) ? <ScheduleGateSection style="pill" /> : null}
      {show(6) ? <BadgeSection /> : null}
    </main>
  );
}
