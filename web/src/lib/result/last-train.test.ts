import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/seo/og-text";
import { searchStations } from "@/lib/stations";
import {
  type LastTrainEntry,
  type LastTrainPerson,
  lastTrainCardLine,
  lastTrainTime,
  marginNote,
  toLastTrainView,
} from "./last-train";
import { toResultView } from "./view-model";

const code = (name: string) => searchStations(name)[0]?.code ?? "000";
type Basis = NonNullable<RecommendResult["lastTrainBasis"]>;
const weekday: Basis = { dayType: "weekday", asOf: "2026-11-16" };

function person(index: number, shortName: string, overrides: Partial<LastTrainPerson> = {}): LastTrainPerson {
  return {
    index,
    participantId: String(index),
    shortName,
    hidden: false,
    isSelf: false,
    originCode: `h${index}`,
    mapUrl: `https://map.kakao.com/link/by/traffic/x/${index}`,
    ...overrides,
  };
}

const station = { code: "k3a", name: "강남" };
const direct = (minute: number, bound = "광교"): LastTrainEntry => ({
  kind: "direct",
  minute,
  boundFor: { stationCode: "dzc", stationName: bound },
});
const transfer = (minute: number): LastTrainEntry => ({ kind: "margin", minute, transfer: true });
const check: LastTrainEntry = { kind: "check" };

function view(
  basis: Basis,
  entries: LastTrainEntry[],
  people: LastTrainPerson[] = entries.map((_, i) => person(i, ["민수", "지연", "하늘", "보라"][i] ?? "")),
) {
  const found = toLastTrainView(
    basis,
    entries.map((entry, i) => ({ ...entry, participantId: people[i]?.participantId ?? String(i) })),
    station,
    people,
  );
  if (!found) throw new Error("막차 칸 없음");
  return found;
}

describe("막차 시각", () => {
  it("직행 확정은 분 그대로, 자정을 넘기면 달력 시각과 '다음 날'", () => {
    expect(lastTrainTime(direct(1443))).toEqual({
      kind: "direct",
      minute: 1443,
      clock: "00:03",
      nextDay: true,
      transfer: false,
      bound: "광교행",
    });
    expect(lastTrainTime(direct(1438))).toMatchObject({ clock: "23:58", nextDay: false });
  });

  it("여유 시각은 10분 단위로 내린다(올리거나 반올림하지 않는다)", () => {
    expect(lastTrainTime(transfer(1389))).toMatchObject({
      kind: "margin",
      minute: 1380,
      clock: "23:00",
      transfer: true,
    });
    expect(lastTrainTime(transfer(1380))).toMatchObject({ minute: 1380, clock: "23:00" });
    // 자정 직후: 24:09 → 24:00 = 다음 날 00:00
    expect(lastTrainTime(transfer(1449))).toMatchObject({ minute: 1440, clock: "00:00", nextDay: true });
    // 23:59 → 23:50: 내려서 자정 전으로 가면 '다음 날'이 아니다.
    expect(lastTrainTime(transfer(1439))).toMatchObject({ clock: "23:50", nextDay: false });
  });

  it("열차 한 대로 가는 여유 시각은 행선지가 있고 갈아타는 길이 아니다", () => {
    const entry: LastTrainEntry = {
      kind: "margin",
      minute: 1425,
      transfer: false,
      boundFor: { stationCode: "7sw", stationName: "김포공항" },
    };
    expect(lastTrainTime(entry)).toMatchObject({ clock: "23:40", transfer: false, bound: "김포공항행" });
  });

  it("확인 필요이거나 값이 없으면 시각이 없다", () => {
    expect(lastTrainTime(check)).toBeNull();
    expect(lastTrainTime(undefined)).toBeNull();
    expect(lastTrainTime({ kind: "direct" })).toBeNull();
  });
});

describe("막차 칸", () => {
  it("맨 위 한 줄은 공개 참가자 중 가장 이른 사람이다(화면에 보이는 시각 기준)", () => {
    // 민수 직행 00:03, 지연 갈아타는 23:09 → 23:00
    const found = view(weekday, [direct(1443), transfer(1389)]);
    expect(found.lead).toBe("지연은 23시 전에 나서야 해요");
    expect(found.rows.map((r) => r.state.kind)).toEqual(["direct", "margin"]);
    expect(found.stationName).toBe("강남역");
    expect(found.dayLabel).toBe("평일");
  });

  it("정각이 아니면 시계 숫자로, 자정을 넘기면 '다음 날'을 붙인다", () => {
    expect(view(weekday, [direct(1443), transfer(1349)]).lead).toBe("지연은 22:20 전에 나서야 해요");
    expect(view(weekday, [direct(1443), direct(1458)]).lead).toBe("민수는 다음 날 00:03 전에 나서야 해요");
    expect(view(weekday, [transfer(1445), direct(1458)]).lead).toBe("민수는 다음 날 00:00 전에 나서야 해요");
  });

  it("확인 필요만 있으면 맨 위 줄이 없다", () => {
    const found = view(weekday, [check, check]);
    expect(found.lead).toBeNull();
    expect(found.rows.map((r) => r.state.kind)).toEqual(["check", "check"]);
    expect(found.checkReason).toBe("이 길은 아직 막차를 계산하지 않아요.");
  });

  it("확인 필요의 이유: 응답 전체의 이유가 먼저, 그다음 일부만 계산한 토요일", () => {
    expect(view({ ...weekday, unavailable: "stale" }, [check]).checkReason).toBe("시간표가 오래돼 확인이 필요해요.");
    expect(view({ ...weekday, unavailable: "date_out_of_range" }, [check]).checkReason).toBe(
      "이 날짜는 공휴일인지 아직 알 수 없어 막차를 보여 드리지 못해요.",
    );
    expect(view({ ...weekday, unavailable: "day_unknown" }, [check]).checkReason).toBe(
      "약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라요.",
    );
    const saturday: Basis = { dayType: "saturday", asOf: "2026-11-16", partial: true };
    expect(view(saturday, [check]).checkReason).toBe("이 길의 토요일 막차는 아직 준비 중이에요.");
    // 평일도 일부 노선만 계산한 요일 종류일 수 있다(9호선을 끈 동안): 이유는 길 쪽으로 말한다.
    expect(view({ ...weekday, partial: true }, [check]).checkReason).toBe("이 길은 아직 막차를 계산하지 않아요.");
  });

  it("일부 노선만 계산한 요일 종류이고 시각이 빠진 줄이 있으면 그 사실을 한 줄로 알린다", () => {
    expect(view(weekday, [check]).partialNote).toBeNull();
    // 모두 시각이 있으면 알릴 것이 없다.
    expect(view({ ...weekday, partial: true }, [direct(1443), transfer(1389)]).partialNote).toBeNull();
    expect(view({ ...weekday, partial: true }, [check]).partialNote).toBe("평일은 일부 노선만 막차를 보여 드려요.");
    expect(view({ dayType: "saturday", asOf: "2026-11-16", partial: true }, [check]).partialNote).toBe(
      "토요일은 일부 노선만 막차를 보여 드려요.",
    );
    expect(view({ dayType: "holiday", asOf: "2026-11-16", partial: true }, [check]).partialNote).toBe(
      "일요일·공휴일은 일부 노선만 막차를 보여 드려요.",
    );
  });

  it("공통 안내는 시간표 날짜, 달라질 수 있다는 것, 걷는 시간을 말한다", () => {
    expect(view(weekday, [check]).footnote).toBe(
      "2026년 11월 16일 시간표로 계산했어요. 공사나 행사가 있으면 달라질 수 있으니 타기 전에 한 번 더 확인해 주세요. 승강장까지 걷는 시간은 따로 잡아 주세요.",
    );
  });

  it("출발역을 숨긴 다른 사람은 줄이 없고, 맨 위 줄에도 들어가지 않는다", () => {
    const people = [person(0, "민수"), person(1, "참가자 2", { hidden: true, originCode: null, mapUrl: null })];
    // 서버는 숨긴 사람의 항목을 주지 않는다.
    const found = toLastTrainView(weekday, [{ ...direct(1443), participantId: "0" }], station, people);
    expect(found?.rows.map((r) => r.name)).toEqual(["민수"]);
    expect(found?.hiddenOthers).toBe(true);
    expect(found?.lead).toBe("민수는 다음 날 00:03 전에 나서야 해요");
  });

  it("숨긴 본인의 줄은 본인 화면에만 있고, 맨 위 줄은 공개 참가자로만 정한다", () => {
    const people = [person(0, "민수"), person(1, "참가자 2", { hidden: true, isSelf: true })];
    const found = view(weekday, [direct(1443), transfer(1309)], people);
    expect(found.rows.map((r) => [r.name, r.onlyMe])).toEqual([
      ["민수", false],
      ["참가자 2", true],
    ]);
    // 숨긴 본인이 더 이르지만(21:40) 맨 위 줄은 민수다: 사람마다 다른 말이 되지 않는다.
    expect(found.lead).toBe("민수는 다음 날 00:03 전에 나서야 해요");
    expect(found.hiddenOthers).toBe(false);
    expect(found.rows[1]?.mapUrl).toBe("https://map.kakao.com/link/by/traffic/x/1");
  });

  it("모두 숨겼고 내가 그중 하나가 아니면 칸이 없다", () => {
    const people = [person(0, "참가자 1", { hidden: true }), person(1, "참가자 2", { hidden: true })];
    expect(toLastTrainView(weekday, [], station, people)).toBeNull();
  });

  it("출발역이 바로 그 역이면 돌아갈 길이 없다고 말하고 버튼을 두지 않는다", () => {
    const people = [person(0, "민수", { originCode: "k3a" }), person(1, "지연")];
    const found = view(weekday, [check, transfer(1389)], people);
    expect(found.rows[0]).toMatchObject({ state: { kind: "same" }, mapUrl: null });
    expect(found.lead).toBe("지연은 23시 전에 나서야 해요");
  });

  it("기준이나 항목이 없으면 칸을 만들지 않는다", () => {
    expect(toLastTrainView(undefined, [], station, [person(0, "민수")])).toBeNull();
    expect(toLastTrainView(weekday, undefined, station, [person(0, "민수")])).toBeNull();
  });

  it("여유 시각의 설명은 갈아타는 길과 열차 한 대로 가는 길이 다르다", () => {
    const changing = lastTrainTime(transfer(1389));
    const single = lastTrainTime({
      kind: "margin",
      minute: 1425,
      transfer: false,
      boundFor: { stationCode: "7sw", stationName: "김포공항" },
    });
    if (!changing || !single) throw new Error("시각 없음");
    expect(marginNote(changing)).toBe("갈아타는 길이라 넉넉히 일찍 잡았어요. 실제 막차는 이보다 늦을 수 있어요.");
    expect(marginNote(single)).toBe(
      "김포공항행 열차 한 대로 가요. 시간표를 한 번 더 맞춰 보기 전이라 넉넉히 일찍 잡았어요. 실제 막차는 이보다 늦을 수 있어요.",
    );
  });

  it("'손해'·'억울'·'AI'처럼 쓰지 않는 말과, 지킬 수 없는 약속('정확한 막차')이 없다", () => {
    const bases: Basis[] = [
      weekday,
      { ...weekday, partial: true },
      { ...weekday, unavailable: "stale" },
      { ...weekday, unavailable: "day_unknown" },
      { ...weekday, unavailable: "date_out_of_range" },
      { dayType: "saturday", asOf: "2026-11-16", partial: true },
    ];
    const texts = bases.flatMap((basis) => {
      const found = view(basis, [direct(1443), transfer(1389), check]);
      const notes = found.rows.flatMap((r) => (r.state.kind === "margin" ? [marginNote(r.state)] : []));
      return [found.lead ?? "", found.checkReason, found.partialNote ?? "", found.footnote, ...notes];
    });
    for (const word of ["손해", "억울", "AI", "정확한"]) expect(texts.join("\n")).not.toContain(word);
  });
});

describe("공유 그림의 막차 줄", () => {
  it("직행 확정은 '막차 00:03', 여유 시각은 '늦어도 23:00', 시각이 없으면 줄이 없다", () => {
    expect(lastTrainCardLine(lastTrainTime(direct(1443)), OG_TEXT)).toBe("막차 00:03");
    expect(lastTrainCardLine(lastTrainTime(transfer(1389)), OG_TEXT)).toBe("늦어도 23:00");
    expect(lastTrainCardLine(lastTrainTime(check), OG_TEXT)).toBeNull();
  });
});

describe("결과를 화면 값으로 바꿀 때의 막차", () => {
  const result: RecommendResult = {
    status: "ok",
    mode: "fair",
    dataVersion: "20261120.4",
    timeBasis: {
      timeSlot: "weekday-night",
      requestedTimeSlot: "weekday-night",
      dayType: "weekday",
      band: "night",
      label: "평일 밤",
      holidayName: null,
    },
    lastTrainBasis: weekday,
    participants: [
      {
        participantId: "0",
        hidden: false,
        originCode: code("광교"),
        originName: "광교",
        nickname: "민수",
        label: "민수",
        labelKind: "name",
        shortLabel: "민수",
      },
      {
        participantId: "1",
        hidden: false,
        originCode: code("부천"),
        originName: "부천",
        nickname: null,
        label: "부천에서 오는 분",
        labelKind: "origin",
        shortLabel: "부천",
      },
    ],
    candidates: [
      {
        rank: 1,
        stationCode: code("강남"),
        stationName: "강남",
        times: [
          { participantId: "0", seconds: 2400, transfers: 0 },
          { participantId: "1", seconds: 3000, transfers: 1 },
        ],
        maxSeconds: 3000,
        spreadSeconds: 600,
        totalSeconds: 5400,
        reasonCode: "FAIR_MINIMAX",
        reason: "가장 오래 걸리는 부천에서 오는 분도 50분이에요.",
        lastTrains: [
          {
            participantId: "0",
            kind: "direct",
            minute: 1443,
            boundFor: { stationCode: code("광교"), stationName: "광교" },
          },
          { participantId: "1", kind: "margin", minute: 1389, transfer: true },
        ],
      },
    ],
  };

  it("후보마다 막차 칸을 만들고, 지도 링크는 만날 역에서 각자의 출발역 방향이다", () => {
    const lastTrain = toResultView(result).candidates[0]?.lastTrain;
    expect(lastTrain?.lead).toBe("부천은 23시 전에 나서야 해요");
    expect(lastTrain?.rows.map((r) => r.name)).toEqual(["민수", "부천"]);
    const toHome = lastTrain?.rows[1]?.mapUrl ?? "";
    const toMeeting = toResultView(result).candidates[0]?.people[1]?.directionsUrl ?? "";
    // 가는 길(출발역 → 만날 역)과 같은 두 곳을 순서만 바꿔 연다.
    const [from, to] = toMeeting.replace("https://map.kakao.com/link/by/traffic/", "").split("/");
    expect(toHome).toBe(`https://map.kakao.com/link/by/traffic/${to}/${from}`);
    expect(decodeURIComponent(toHome)).toContain("강남역,");
  });

  it("옛 링크(v=1)처럼 막차를 보이지 않기로 하면 칸이 없다", () => {
    expect(toResultView(result, { lastTrains: false }).candidates[0]?.lastTrain).toBeNull();
  });

  it("막차를 모르는 서버의 응답(기준·항목 없음)에는 칸이 없다", () => {
    const { lastTrainBasis: _basis, ...rest } = result;
    const old: RecommendResult = {
      ...rest,
      candidates: rest.candidates.map(({ lastTrains: _trains, ...candidate }) => candidate),
    };
    expect(toResultView(old).candidates[0]?.lastTrain).toBeNull();
  });
});
