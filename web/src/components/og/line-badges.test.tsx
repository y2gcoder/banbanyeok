import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stationByCode } from "@/lib/stations";
import { lineColor, lineShortLabel, lineTextColor } from "@/lib/stations/lines";
import { OgLineBadges } from "./line-badges";

describe("OG 만날 역 호선 배지", () => {
  it("만날 역 코드로 조회하고 화면의 순서·색·짧은 이름을 유지한다", () => {
    const station = stationByCode("s1q");
    if (!station) throw new Error("역 없음");
    const markup = renderToStaticMarkup(<OgLineBadges stationCode={station.code} />);
    let previous = -1;
    for (const line of station.lines) {
      const position = markup.indexOf(`>${lineShortLabel(line)}</div>`);
      expect(position).toBeGreaterThan(previous);
      previous = position;
      expect(markup).toContain(`background-color:${lineColor(line)}`);
      expect(markup).toContain(`color:${lineTextColor(line)}`);
    }
  });

  it("4노선은 앞 3개 + 외 1, 숫자는 원·이름은 캡슐", () => {
    const markup = renderToStaticMarkup(<OgLineBadges lines={["2호선", "경의중앙선", "공항철도", "수인분당선"]} />);
    expect(markup).toContain("외 1");
    expect(markup).not.toContain("수인분당");
    expect(markup).toContain("width:36px");
    expect(markup).toContain("padding:0 10px");
  });

  it("코드를 모르거나 노선이 없으면 배지를 추정하지 않는다", () => {
    expect(renderToStaticMarkup(<OgLineBadges stationCode="unknown" />)).toBe("");
    expect(renderToStaticMarkup(<OgLineBadges lines={[]} />)).toBe("");
  });
});
