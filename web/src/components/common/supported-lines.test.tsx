// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { regionScope } from "@/lib/stations/coverage";

const SUPPORTED_LINES = regionScope("capital").lines;

import { SupportedLinesDisclosure } from "./supported-lines";

describe("첫 화면 계산 범위 한 줄(#170)", () => {
  it("개수는 지원 노선 수이고, 누르면 펼쳐진다(aria-expanded)", async () => {
    const user = userEvent.setup();
    render(<SupportedLinesDisclosure />);
    const button = screen.getByRole("button", { name: `수도권 전철 ${SUPPORTED_LINES.length}개 노선을 계산해요` });
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
    expect(panel).not.toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent("임진강·운천(경의중앙선), 인천자기부상은 아직 계산하지 않아요.");
    for (const line of SUPPORTED_LINES) expect(panel).toHaveTextContent(line);
  });
});
