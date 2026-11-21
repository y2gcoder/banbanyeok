import { describe, expect, it } from "vitest";
import { findProblem, PROBLEM_DOCS, problemBody, problemType } from "./problems";

describe("오류 코드 문서", () => {
  it("type 주소의 slug는 code의 kebab-case이고 겹치지 않는다", () => {
    for (const problem of PROBLEM_DOCS) {
      expect(problem.slug).toBe(problem.code.toLowerCase().replaceAll("_", "-"));
      expect(problemType(problem)).toBe(`https://banbanyeok.app/problems/${problem.slug}`);
    }
    expect(new Set(PROBLEM_DOCS.map((p) => p.slug)).size).toBe(PROBLEM_DOCS.length);
  });

  it("slug로 찾고 없는 slug는 undefined다", () => {
    expect(findProblem("room-full")).toMatchObject({ code: "ROOM_FULL", status: 409 });
    expect(findProblem("ROOM_FULL")).toBeUndefined();
    expect(findProblem("nope")).toBeUndefined();
  });

  it("웹이 코드로 분기하는 오류가 모두 문서에 있다", () => {
    for (const code of [
      "ROOM_FULL",
      "ROOM_LOCKED",
      "ROOM_NOT_FOUND",
      "ROOM_CHANGED",
      "RATE_LIMITED",
      "INTERNAL_ERROR",
      "CORS_REJECTED",
      "NOT_ACCEPTABLE",
      "UNSUPPORTED_MEDIA_TYPE",
      "UPSTREAM_UNAVAILABLE",
      "UPSTREAM_NOT_CONFIGURED",
      "UPSTREAM_TIMEOUT",
    ]) {
      expect(
        PROBLEM_DOCS.some((p) => p.code === code),
        code,
      ).toBe(true);
    }
  });

  it("웹 쪽이 만드는 오류 본문: 표의 코드는 표의 type·제목, 없는 코드는 about:blank", () => {
    expect(problemBody(502, "UPSTREAM_UNAVAILABLE", "연결하지 못했어요")).toEqual({
      type: "https://banbanyeok.app/problems/upstream-unavailable",
      title: "서버에 연결하지 못함",
      status: 502,
      detail: "연결하지 못했어요",
      code: "UPSTREAM_UNAVAILABLE",
    });
    expect(problemBody(501, "NOT_IMPLEMENTED", "x")).toMatchObject({ type: "about:blank", title: "Not Implemented" });
  });
});
