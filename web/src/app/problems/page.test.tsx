// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PROBLEM_DOCS } from "@/lib/problems/problems";
import ProblemPage, { generateStaticParams } from "./[slug]/page";
import ProblemsPage, { metadata } from "./page";

describe("/problems", () => {
  it("모든 코드를 앵커가 있는 항목으로 보여 준다", () => {
    render(<ProblemsPage />);
    expect(screen.getByRole("heading", { level: 1, name: "API 오류 코드" })).toBeTruthy();
    for (const problem of PROBLEM_DOCS) {
      const section = document.getElementById(problem.slug);
      expect(section, problem.code).not.toBeNull();
      expect(within(section as HTMLElement).getByText(problem.code)).toBeTruthy();
      expect(
        within(screen.getByRole("navigation", { name: "오류 코드 목록" })).getByRole("link", { name: problem.code }),
      ).toHaveProperty("hash", `#${problem.slug}`);
    }
  });

  it("검색에 노출하지 않는다", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("/problems/[slug]", () => {
  it("코드마다 정적 페이지를 만든다", () => {
    expect(generateStaticParams().map((p) => p.slug)).toEqual(PROBLEM_DOCS.map((p) => p.slug));
  });

  it("해당 코드의 제목·상태·뜻과 목록으로 가는 링크를 보여 준다", async () => {
    render(await ProblemPage({ params: Promise.resolve({ slug: "room-full" }) }));
    expect(screen.getByRole("heading", { level: 1, name: "방이 가득 참" })).toBeTruthy();
    expect(screen.getByText("ROOM_FULL")).toBeTruthy();
    expect(screen.getByText("409")).toBeTruthy();
    expect(screen.getByRole("link", { name: "오류 코드 전체 보기" })).toHaveProperty("pathname", "/problems");
  });
});
