// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import {
  type LastTrainEntry,
  type LastTrainPerson,
  type MeetingWhen,
  recalculatingLastTrainView,
  toLastTrainView,
} from "@/lib/result/last-train";
import { LastTrains } from "./last-trains";

type Basis = NonNullable<RecommendResult["lastTrainBasis"]>;
const weekday: Basis = { dayType: "weekday", asOf: "2026-11-16" };
const station = { code: "k3a", name: "강남" };

function person(index: number, shortName: string, overrides: Partial<LastTrainPerson> = {}): LastTrainPerson {
  return {
    index,
    participantId: String(index),
    shortName,
    hidden: false,
    isSelf: false,
    originCode: `h${index}`,
    mapUrl: `https://map.kakao.com/link/by/traffic/meeting/home${index}`,
    ...overrides,
  };
}

function view(basis: Basis, entries: LastTrainEntry[], people: LastTrainPerson[], meeting?: MeetingWhen) {
  const found = toLastTrainView(
    basis,
    entries.map((entry, i) => ({ ...entry, participantId: people[i]?.participantId ?? "" })),
    station,
    people,
    meeting,
  );
  if (!found) throw new Error("막차 칸 없음");
  return found;
}

const direct: LastTrainEntry = { kind: "direct", minute: 1443, boundFor: { stationCode: "dzc", stationName: "광교" } };
const changing: LastTrainEntry = { kind: "margin", minute: 1349, transfer: true };
const single: LastTrainEntry = {
  kind: "margin",
  minute: 1425,
  transfer: false,
  boundFor: { stationCode: "7sw", stationName: "김포공항" },
};

describe("집에 가는 막차 칸", () => {
  it("직행 확정은 분 그대로와 행선지, 여유 시각은 10분 단위로 내린 '늦어도'와 지도 버튼, 확인 필요는 이유와 지도 버튼", () => {
    const people = [person(0, "민수"), person(1, "지연"), person(2, "하늘"), person(3, "보라")];
    render(<LastTrains view={view(weekday, [direct, changing, single, { kind: "check" }], people)} />);
    // 영역 이름에 역 이름이 들어간다: 후보를 여러 개 펼쳐도 서로 구분된다.
    const section = screen.getByRole("region", { name: "강남역 집에 가는 막차" });
    expect(within(section).getByText("평일 시간표")).toBeInTheDocument();
    // 확인 필요인 사람(보라)이 있어 범위를 밝힌다.
    expect(within(section).getByText("공개된 시각 중 가장 이름: 지연 22:20 · 더 확인할 분 있음")).toBeInTheDocument();

    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    // 직행 확정: 버튼이 없다.
    expect(rows[0]).toHaveTextContent("민수막차00:03다음 날· 광교행강남역 출발 시각");
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
    // 갈아타는 여유 시각: 22:29 → 22:20
    expect(rows[1]).toHaveTextContent("늦어도22:20출발");
    expect(rows[1]).toHaveTextContent("환승 경로라 넉넉히 이르게 잡은 시각. 실제 막차는 이보다 늦을 수 있어요.");
    expect(
      within(rows[1] as HTMLElement).getByRole("link", { name: "지연, 지도 앱에서 막차 확인하기" }),
    ).toHaveAttribute("href", "https://map.kakao.com/link/by/traffic/meeting/home1");
    // 열차 한 대로 가는 여유 시각: 23:45 → 23:40
    expect(rows[2]).toHaveTextContent("늦어도23:40출발");
    expect(rows[2]).toHaveTextContent("김포공항행 직행.");
    // 확인 필요: 시각이 없다.
    expect(rows[3]).toHaveTextContent("보라이 경로는 막차 계산 전.지도 앱에서 막차 확인하기");
    expect(rows[3]).not.toHaveTextContent(/\d\d:\d\d/);
    expect(within(section).getByText(/^시간표 수집 기준 2026년 11월 16일\. 공사·행사로/)).toBeInTheDocument();
    expect(section).not.toHaveTextContent("계산했어요");
    // 지도 링크는 새 탭으로만 열린다(누를 때만 카카오맵으로 간다).
    for (const link of within(section).getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveTextContent("지도 앱에서 막차 확인하기");
    }
  });

  it("모두 시각이 있으면 맨 위 줄은 가장 이른 사람 한 줄이다", () => {
    render(<LastTrains view={view(weekday, [direct, changing], [person(0, "민수"), person(1, "지연")])} />);
    expect(screen.getByText("지연 22:20 전 출발")).toBeInTheDocument();
    expect(screen.queryByText(/공개된 시각 중에는/)).toBeNull();
  });

  it("펼친 채로 시작하고 제목 버튼(aria-expanded)으로 접는다. 접혀도 가장 이른 시각 한 줄은 남는다", async () => {
    const user = userEvent.setup();
    render(<LastTrains view={view(weekday, [direct, changing], [person(0, "민수"), person(1, "지연")])} />);
    const toggle = screen.getByRole("button", { name: /강남역 집에 가는 막차/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // 제목 안의 버튼이다(제목 탐색으로도 닿는다).
    expect(toggle.closest("h3")).not.toBeNull();
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
    expect(panel).toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    expect(toggle).toHaveFocus();
    // 막차는 숨기지 않는다: 접힌 제목 아래에 맨 위 한 줄과 같은 말이 보인다.
    expect(within(toggle).getByText("지연 22:20 전 출발")).toBeVisible();
    await user.click(toggle);
    expect(panel).toBeVisible();
  });

  it("접힌 채로 시작할 수 있다(1위 카드 요약). 계산하지 못한 응답이면 접힌 줄이 그 이유다", () => {
    const people = [person(0, "민수"), person(1, "지연")];
    const { unmount } = render(<LastTrains view={view(weekday, [direct, changing], people)} defaultOpen={false} />);
    const toggle = screen.getByRole("button", { name: /집에 가는 막차/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle).getByText("지연 22:20 전 출발")).toBeVisible();
    unmount();
    render(
      <LastTrains view={view({ ...weekday, unavailable: "stale" }, [direct, changing], people)} defaultOpen={false} />,
    );
    expect(
      within(screen.getByRole("button", { name: /집에 가는 막차/ })).getByText(
        "시간표가 오래돼 막차를 보여 드리지 못해요.",
      ),
    ).toBeVisible();
  });

  it("계산하지 못한 응답: 이유가 맨 위에 한 번, 요일 표제·일부 노선·'계산했어요'는 없다", () => {
    const people = [person(0, "민수"), person(1, "지연")];
    const cases = [
      ["stale", "시간표가 오래돼 막차를 보여 드리지 못해요."],
      ["date_out_of_range", "이 날짜는 공휴일인지 아직 알 수 없어 막차를 보여 드리지 못해요."],
      ["day_unknown", "약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라 보여 드리지 못해요."],
    ] as const;
    for (const [unavailable, reason] of cases) {
      const { unmount } = render(
        <LastTrains
          view={view({ ...weekday, partial: true, unavailable }, [{ kind: "check" }, { kind: "check" }], people)}
        />,
      );
      const section = screen.getByRole("region", { name: "강남역 집에 가는 막차" });
      expect(within(section).getAllByText(reason), unavailable).toHaveLength(1);
      expect(section, unavailable).not.toHaveTextContent(/평일|시간표로|계산했어요|일부 노선|전 출발/);
      expect(section, unavailable).not.toHaveTextContent(/\d\d:\d\d/);
      expect(within(section).getByText("시간표 수집 기준 2026년 11월 16일.")).toBeInTheDocument();
      // 이유가 줄보다 먼저 나온다.
      const text = section.textContent ?? "";
      expect(text.indexOf(reason), unavailable).toBeLessThan(text.indexOf("민수"));
      // 줄에는 이름과 지도 앱 버튼이 남는다.
      expect(within(section).getAllByRole("link", { name: /지도 앱에서 막차 확인하기/ })).toHaveLength(2);
      unmount();
    }
  });

  it("일부 노선만 계산한 요일 종류면 모두 시각이 있어도 한 줄로 알린다", () => {
    const saturday: Basis = { dayType: "saturday", asOf: "2026-11-16", partial: true };
    const people = [person(0, "민수"), person(1, "지연")];
    const { unmount } = render(<LastTrains view={view(saturday, [direct, { kind: "check" }], people)} />);
    expect(screen.getByText("토요일 시간표")).toBeInTheDocument();
    expect(screen.getByText("이 경로의 토요일 막차는 준비 중.")).toBeInTheDocument();
    expect(screen.getByText("토요일은 일부 노선만 막차 표시.")).toBeInTheDocument();
    unmount();
    render(<LastTrains view={view({ ...weekday, partial: true }, [direct, changing], people)} />);
    expect(screen.getByText("평일은 일부 노선만 막차 표시.")).toBeInTheDocument();
  });

  it("새벽 약속: 약속보다 먼저 떠나는 열차는 시각을 크게 보이지 않고 '약속 전에 떠나요'로 알린다", () => {
    const people = [person(0, "민수"), person(1, "지연")];
    const samseong: LastTrainEntry = {
      kind: "direct",
      minute: 1467,
      boundFor: { stationCode: "kf1", stationName: "삼성" },
    };
    const { unmount } = render(
      <LastTrains view={view(weekday, [samseong, changing], people, { date: "2026-11-28", time: "02:59" })} />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("민수11월 28일 00:27 막차는 약속 전에 떠나요.지도 앱에서 막차 확인하기");
    expect(rows[1]).toHaveTextContent("넉넉히 잡으면 11월 27일 22:20엔 떠나야 해서 약속 시각보다 일러요.");
    expect(screen.getByText("약속 전에 막차가 떠나는 분이 있어요.")).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "강남역 집에 가는 막차" });
    expect(section).not.toHaveTextContent(/다음 날|전 출발|늦어도|삼성행/);
    unmount();
    // 03:00 약속(토요일 운행일)이면 그날 밤 막차를 그대로 보인다.
    render(
      <LastTrains
        view={view(weekday, [{ ...samseong, minute: 1407 }, changing], people, { date: "2026-11-28", time: "03:00" })}
      />,
    );
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("민수막차23:27· 삼성행");
    expect(screen.getByText("지연 22:20 전 출발")).toBeInTheDocument();
  });

  it("약속과 같은 분에 떠나는 열차는 '약속 시각에 떠나요'로 알리고 귀가 시각으로 보이지 않는다", () => {
    const people = [person(0, "민수"), person(1, "지연")];
    // 민수 직행 00:03, 약속도 00:03. 지연 갈아타는 여유 시각은 전날 22:20.
    render(<LastTrains view={view(weekday, [direct, changing], people, { date: "2026-11-28", time: "00:03" })} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("민수11월 28일 00:03 막차는 약속 시각에 떠나요.지도 앱에서 막차 확인하기");
    expect(screen.getByText("약속 시각에 막차가 떠나는 분이 있어요.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "강남역 집에 가는 막차" })).not.toHaveTextContent(
      /전 출발|늦어도|광교행/,
    );
  });

  it("방이 바뀌어 다시 계산하는 중이면 그 말만 보인다(이전 결과의 시각·요일·줄이 없다)", () => {
    render(<LastTrains view={recalculatingLastTrainView({ name: "강남" })} />);
    const section = screen.getByRole("region", { name: "강남역 집에 가는 막차" });
    expect(section).toHaveTextContent("집에 가는 막차방 내용이 바뀌어 막차 다시 계산 중");
    expect(within(section).queryByRole("list")).toBeNull();
    expect(section).not.toHaveTextContent(/\d\d:\d\d|시간표|전 출발/);
  });

  it("모두 출발역을 숨긴 방을 다른 사람이 보면 줄 없이 '본인 화면에서만 보여요'만 보인다", () => {
    const people = [person(0, "참가자 1", { hidden: true }), person(1, "참가자 2", { hidden: true })];
    const found = toLastTrainView({ ...weekday, partial: true }, [], station, people);
    if (!found) throw new Error("막차 칸 없음");
    render(<LastTrains view={found} />);
    const section = screen.getByRole("region", { name: "강남역 집에 가는 막차" });
    expect(section).toHaveTextContent("집에 가는 막차출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.");
    expect(section).not.toHaveTextContent(/평일|일부 노선|수집 기준|참가자/);
    expect(within(section).queryByRole("list")).toBeNull();
  });

  it("출발역을 숨긴 다른 사람은 줄이 없고 안내 한 줄만 있다", () => {
    const people = [person(0, "민수"), person(1, "참가자 2", { hidden: true, originCode: null, mapUrl: null })];
    const found = toLastTrainView(weekday, [{ ...direct, participantId: "0" }], station, people);
    if (!found) throw new Error("막차 칸 없음");
    render(<LastTrains view={found} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("참가자 2")).toBeNull();
    expect(screen.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeInTheDocument();
  });

  it("출발역을 숨긴 본인에게는 내 줄이 보이고 나에게만 보인다고 적는다", () => {
    const people = [person(0, "민수"), person(1, "참가자 2", { hidden: true, isSelf: true })];
    render(<LastTrains view={view(weekday, [direct, changing], people)} meIndex={1} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[1]).toHaveTextContent("참가자 2(나)나에게만 보여요");
    expect(rows[1]).toHaveTextContent("늦어도22:20출발");
    expect(screen.queryByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeNull();
    // 맨 위 줄은 공개 참가자(민수)로 정한다.
    expect(screen.getByText("공개된 시각 중 가장 이름: 민수 다음 날 00:03")).toBeInTheDocument();
  });

  it("출발역이 바로 그 역인 사람에게는 버튼 없이 한 줄만 보인다", () => {
    const people = [person(0, "민수", { originCode: "k3a" }), person(1, "지연")];
    render(<LastTrains view={view(weekday, [{ kind: "check" }, changing], people)} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("민수출발역과 같은 역");
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
  });

  it("공개한 사람은 이 역에서 출발하고 다른 친구는 숨겼으면: 접힌 줄은 공개한 사람으로 한정하고, 펼친 칸과 어긋나지 않는다", async () => {
    const user = userEvent.setup();
    // 민수의 출발역이 후보역(강남)이고, 다른 역에서 오는 참가자 2는 출발역을 숨겼다(다른 사람 화면: 민수 줄만 있다).
    const people = [
      person(0, "민수", { originCode: "k3a" }),
      person(1, "참가자 2", { hidden: true, originCode: null, mapUrl: null }),
    ];
    render(<LastTrains view={view(weekday, [direct], people)} defaultOpen={false} />);
    const toggle = screen.getByRole("button", { name: /집에 가는 막차/ });
    expect(within(toggle).getByText("공개된 분은 모두 이 역에서 출발")).toBeVisible();
    await user.click(toggle);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("민수출발역과 같은 역");
    expect(screen.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeVisible();
  });
});
