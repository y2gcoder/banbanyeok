import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/common/wordmark";
import { findProblem, PROBLEM_DOCS, PROBLEMS_PATH } from "@/lib/problems/problems";
import { plainPageMetadata } from "@/lib/seo/metadata";
import { BackToList, ProblemEntry, ProblemsShell } from "../problem-view";

type Props = { params: Promise<{ slug: string }> };

// 표에 있는 코드만 연다. 그 밖의 주소는 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return PROBLEM_DOCS.map((problem) => ({ slug: problem.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const problem = findProblem((await params).slug);
  if (!problem) return {};
  return {
    ...plainPageMetadata({
      title: `${problem.title} (${problem.code})`,
      description: problem.meaning,
      path: `${PROBLEMS_PATH}/${problem.slug}`,
    }),
    robots: { index: false, follow: false },
  };
}

export default async function ProblemPage({ params }: Props) {
  const problem = findProblem((await params).slug);
  if (!problem) notFound();
  return (
    <ProblemsShell>
      <Wordmark />
      <ProblemEntry problem={problem} heading="h1" />
      <BackToList />
    </ProblemsShell>
  );
}
