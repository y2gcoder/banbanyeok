/**
 * 오류 코드 문서(`/problems`)가 쓰는 조회와, 이 웹 쪽(프록시·가짜 서버)이 직접 만드는 오류 본문. 표는 contracts/problems.json에서 만든
 * problems.gen.ts다(가짜 서버(mock/)도 불러오므로 import에 `.ts` 확장자를 쓴다).
 */
import { PROBLEMS } from "./problems.gen.ts";

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

/** 표에 없는 코드(가짜 서버 전용)의 `title`. RFC 9457 §4.2.1: `type`이 `about:blank`이면 title은 HTTP 상태의 이름을 쓴다. */
const STATUS_TITLES: Readonly<Record<number, string>> = { 501: "Not Implemented" };

/**
 * 웹 쪽이 직접 만드는 오류 응답의 본문(`application/problem+json`, 서버의 `ProblemDto`와 같은 필드). 표에 있는 코드는 표의 type·제목을 쓰고,
 * 없는 코드는 `type: "about:blank"`다(문서 주소를 약속하지 않는다).
 */
export function problemBody(status: number, code: string, detail: string) {
  const doc = PROBLEM_DOCS.find((problem) => problem.code === code);
  if (!doc)
    return {
      type: "about:blank",
      title: STATUS_TITLES[status] ?? `HTTP ${status}`,
      status,
      detail,
      code,
    };
  return { type: problemType(doc), title: doc.title, status, detail, code };
}

export const PROBLEM_JSON_TYPE = "application/problem+json; charset=utf-8";
