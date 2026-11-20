// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { type LastTrainEntry, type LastTrainPerson, toLastTrainView } from "@/lib/result/last-train";
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

function view(basis: Basis, entries: LastTrainEntry[], people: LastTrainPerson[]) {
  const found = toLastTrainView(
    basis,
    entries.map((entry, i) => ({ ...entry, participantId: people[i]?.participantId ?? "" })),
    station,
    people,
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
    const section = screen.getByRole("region", { name: "집에 가는 막차" });
    expect(within(section).getByText("평일 시간표")).toBeInTheDocument();
    expect(within(section).getByText("지연은 22:20 전에 나서야 해요")).toBeInTheDocument();

    const rows = within(section).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    // 직행 확정: 버튼이 없다.
    expect(rows[0]).toHaveTextContent("민수막차00:03다음 날· 광교행강남역에서 열차가 떠나는 시각이에요.");
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
    // 갈아타는 여유 시각: 22:29 → 22:20
    expect(rows[1]).toHaveTextContent("늦어도22:20엔출발하세요");
    expect(rows[1]).toHaveTextContent("갈아타는 길이라 넉넉히 일찍 잡았어요. 실제 막차는 이보다 늦을 수 있어요.");
    expect(
      within(rows[1] as HTMLElement).getByRole("link", { name: "지연, 지도 앱에서 막차 확인하기" }),
    ).toHaveAttribute("href", "https://map.kakao.com/link/by/traffic/meeting/home1");
    // 열차 한 대로 가는 여유 시각: 23:45 → 23:40
    expect(rows[2]).toHaveTextContent("늦어도23:40엔출발하세요");
    expect(rows[2]).toHaveTextContent("김포공항행 열차 한 대로 가요.");
    // 확인 필요: 시각이 없다.
    expect(rows[3]).toHaveTextContent("보라이 길은 아직 막차를 계산하지 않아요.지도 앱에서 막차 확인하기");
    expect(rows[3]).not.toHaveTextContent(/\d\d:\d\d/);
    expect(within(section).getByText(/^2026년 11월 16일 시간표로 계산했어요\./)).toBeInTheDocument();
    // 지도 링크는 새 탭으로만 열린다(누를 때만 카카오맵으로 간다).
    for (const link of within(section).getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link).toHaveTextContent("지도 앱에서 막차 확인하기");
    }
  });

  it("확인 필요만 있으면 맨 위 줄이 없다", () => {
    const people = [person(0, "민수"), person(1, "지연")];
    render(
      <LastTrains view={view({ ...weekday, unavailable: "stale" }, [{ kind: "check" }, { kind: "check" }], people)} />,
    );
    expect(screen.queryByText(/나서야 해요/)).toBeNull();
    expect(screen.getAllByText("시간표가 오래돼 확인이 필요해요.")).toHaveLength(2);
  });

  it("일부 노선만 계산한 요일 종류면 한 줄로 알린다", () => {
    const saturday: Basis = { dayType: "saturday", asOf: "2026-11-16", partial: true };
    render(<LastTrains view={view(saturday, [direct, { kind: "check" }], [person(0, "민수"), person(1, "지연")])} />);
    expect(screen.getByText("토요일 시간표")).toBeInTheDocument();
    expect(screen.getByText("이 길의 토요일 막차는 아직 준비 중이에요.")).toBeInTheDocument();
    expect(screen.getByText("토요일은 일부 노선만 막차를 보여 드려요.")).toBeInTheDocument();
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
    expect(rows[1]).toHaveTextContent("늦어도22:20엔출발하세요");
    expect(screen.queryByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeNull();
    // 맨 위 줄은 공개 참가자(민수)로 정한다.
    expect(screen.getByText("민수는 다음 날 00:03 전에 나서야 해요")).toBeInTheDocument();
  });

  it("출발역이 바로 그 역인 사람에게는 버튼 없이 한 줄만 보인다", () => {
    const people = [person(0, "민수", { originCode: "k3a" }), person(1, "지연")];
    render(<LastTrains view={view(weekday, [{ kind: "check" }, changing], people)} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("민수출발역이 바로 이 역이에요.");
    expect(within(rows[0] as HTMLElement).queryByRole("link")).toBeNull();
  });
});
