import Link from "next/link";
import { PROBLEMS_PATH, type ProblemDoc, problemType } from "@/lib/problems/problems";

/** 오류 하나의 설명. 목록(`/problems`)에서는 앵커(`#slug`)가 걸리고, 개별 페이지(`/problems/slug`)에서는 본문이 된다. */
export function ProblemEntry({ problem, heading: Heading }: { problem: ProblemDoc; heading: "h1" | "h2" }) {
  return (
    <section id={problem.slug} aria-labelledby={`${problem.slug}-title`} className="flex scroll-mt-6 flex-col gap-2">
      <Heading id={`${problem.slug}-title`} className="text-[20px] leading-snug font-extrabold text-ink">
        {problem.title}
      </Heading>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-muted-foreground">
        <div className="flex gap-1.5">
          <dt>코드</dt>
          <dd className="font-mono font-semibold text-ink">{problem.code}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt>HTTP 상태</dt>
          <dd className="font-mono font-semibold text-ink">{problem.status}</dd>
        </div>
      </dl>
      <p className="text-[15px] leading-relaxed text-ink-soft">{problem.meaning}</p>
      <p className="text-[13px] break-all text-muted-foreground">
        <span className="sr-only">type 주소: </span>
        <code>{problemType(problem)}</code>
      </p>
    </section>
  );
}

export function ProblemsShell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-gutter pt-5 pb-10">{children}</main>;
}

export function BackToList() {
  return (
    <Link
      href={PROBLEMS_PATH}
      className="inline-flex min-h-11 w-fit items-center text-[15px] font-bold text-ink underline underline-offset-4"
    >
      오류 코드 전체 보기
    </Link>
  );
}
