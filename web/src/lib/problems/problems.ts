/** 오류 코드 문서(`/problems`)가 쓰는 조회. 표는 contracts/problems.json에서 만든 problems.gen.ts다. */
import { PROBLEMS } from "./problems.gen";

export type ProblemDoc = (typeof PROBLEMS.items)[number];

export const PROBLEM_DOCS: readonly ProblemDoc[] = PROBLEMS.items;

export const PROBLEMS_PATH = "/problems";

export function findProblem(slug: string): ProblemDoc | undefined {
  return PROBLEM_DOCS.find((problem) => problem.slug === slug);
}

/** 응답의 `type`이 가리키는 주소. 서버(`ProblemTypes.typeUri`)와 같은 규칙이다. */
export function problemType(problem: ProblemDoc): string {
  return `${PROBLEMS.baseUri}${problem.slug}`;
}
