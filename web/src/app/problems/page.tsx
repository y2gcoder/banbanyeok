import type { Metadata } from "next";
import { Wordmark } from "@/components/common/wordmark";
import { PROBLEM_DOCS, PROBLEMS_PATH } from "@/lib/problems/problems";
import { plainPageMetadata } from "@/lib/seo/metadata";
import { ProblemEntry, ProblemsShell } from "./problem-view";

// API 오류 응답의 `type` 주소가 가리키는 문서다. 개발자용이라 검색에 노출하지 않고 sitemap에도 넣지 않는다.
export const metadata: Metadata = {
  ...plainPageMetadata({
    title: "API 오류 코드",
    description: "반반역 API가 돌려주는 오류 코드와 뜻을 모아 둔 문서입니다.",
    path: PROBLEMS_PATH,
  }),
  robots: { index: false, follow: false },
};

export default function ProblemsPage() {
  return (
    <ProblemsShell>
      <Wordmark />
      <header className="flex flex-col gap-2">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-ink">API 오류 코드</h1>
        <p className="text-[15px] leading-relaxed text-ink-soft">
          반반역 API의 오류 응답은 <code>application/problem+json</code>(RFC 9457)입니다. 응답의 <code>type</code>이 이
          문서의 코드별 주소를 가리키고, 분기는 <code>code</code>로 합니다.
        </p>
      </header>
      <nav aria-label="오류 코드 목록">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {PROBLEM_DOCS.map((problem) => (
            <li key={problem.slug}>
              <a
                href={`#${problem.slug}`}
                className="inline-flex min-h-11 items-center font-mono text-ink underline underline-offset-4"
              >
                {problem.code}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {PROBLEM_DOCS.map((problem) => (
        <ProblemEntry key={problem.slug} problem={problem} heading="h2" />
      ))}
    </ProblemsShell>
  );
}
