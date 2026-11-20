import { describe, expect, it } from "vitest";
import type { RecommendResult } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/seo/og-text";
import { searchStations } from "@/lib/stations";
import {
  type LastTrainEntry,
  type LastTrainPerson,
  lastTrainCardLine,
  lastTrainState,
  type MeetingWhen,
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
  meeting?: MeetingWhen,
) {
  const found = toLastTrainView(
    basis,
    entries.map((entry, i) => ({ ...entry, participantId: people[i]?.participantId ?? String(i) })),
    station,
    people,
    meeting,
  );
  if (!found) throw new Error("막차 칸 없음");
  return found;
}

describe("막차 시각", () => {
  it("직행 확정은 분 그대로, 자정을 넘기면 달력 시각과 '다음 날'", () => {
    expect(lastTrainState(direct(1443))).toEqual({
      kind: "direct",
      minute: 1443,
      clock: "00:03",
      nextDay: true,
      transfer: false,
      bound: "광교행",
    });
    expect(lastTrainState(direct(1438))).toMatchObject({ clock: "23:58", nextDay: false });
  });

  it("여유 시각은 10분 단위로 내린다(올리거나 반올림하지 않는다)", () => {
    expect(lastTrainState(transfer(1389))).toMatchObject({
      kind: "margin",
      minute: 1380,
      clock: "23:00",
      transfer: true,
    });
    expect(lastTrainState(transfer(1380))).toMatchObject({ minute: 1380, clock: "23:00" });
    // 자정 직후: 24:09 → 24:00 = 다음 날 00:00
    expect(lastTrainState(transfer(1449))).toMatchObject({ minute: 1440, clock: "00:00", nextDay: true });
    // 23:59 → 23:50: 내려서 자정 전으로 가면 '다음 날'이 아니다.
    expect(lastTrainState(transfer(1439))).toMatchObject({ clock: "23:50", nextDay: false });
  });

  it("열차 한 대로 가는 여유 시각은 행선지가 있고 갈아타는 길이 아니다", () => {
    const entry: LastTrainEntry = {
      kind: "margin",
      minute: 1425,
      transfer: false,
      boundFor: { stationCode: "7sw", stationName: "김포공항" },
    };
    expect(lastTrainState(entry)).toMatchObject({ clock: "23:40", transfer: false, bound: "김포공항행" });
  });

  it("확인 필요이거나 값이 없으면 시각이 없다", () => {
    expect(lastTrainState(check)).toBeNull();
    expect(lastTrainState(undefined)).toBeNull();
    expect(lastTrainState({ kind: "direct" })).toBeNull();
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

  it("확인 필요가 섞이면 맨 위 줄이 범위를 밝힌다: 공개된 시각 중에 가장 이른 것", () => {
    // 민수 직행 00:03, 지연 열차 한 대 여유 23:45 → 23:40, 하늘 확인 필요.
    const single: LastTrainEntry = { kind: "margin", minute: 1425, transfer: false };
    expect(view(weekday, [direct(1443), single, check]).lead).toBe(
      "공개된 시각 중에는 지연의 23:40이 가장 일러요. 막차를 더 확인해야 할 분도 있어요.",
    );
    // 조사는 시각의 끝 숫자를 읽는 소리로 고른다(2 → "가"), 자정을 넘기면 "다음 날"을 붙인다.
    expect(view(weekday, [direct(1432), check]).lead).toBe(
      "공개된 시각 중에는 민수의 23:52가 가장 일러요. 막차를 더 확인해야 할 분도 있어요.",
    );
    expect(view(weekday, [direct(1443), check]).lead).toBe(
      "공개된 시각 중에는 민수의 다음 날 00:03이 가장 일러요. 막차를 더 확인해야 할 분도 있어요.",
    );
    // 출발역이 바로 그 역인 사람은 확인할 것이 없다: 범위를 좁혀 말하지 않는다.
    const people = [person(0, "민수", { originCode: "k3a" }), person(1, "지연")];
    expect(view(weekday, [check, transfer(1389)], people).lead).toBe("지연은 23시 전에 나서야 해요");
  });

  it("숨긴 본인의 줄이 확인 필요여도 공용 문구(맨 위 줄)는 바뀌지 않는다", () => {
    const people = [person(0, "민수"), person(1, "참가자 2", { hidden: true, isSelf: true })];
    expect(view(weekday, [direct(1432), check], people).lead).toBe("민수는 23:52 전에 나서야 해요");
  });

  it("계산한 응답의 확인 필요 이유: 일부만 계산한 토요일이면 그 사실, 아니면 이 길을 아직 계산하지 않는다", () => {
    const saturday: Basis = { dayType: "saturday", asOf: "2026-11-16", partial: true };
    expect(view(saturday, [check]).checkReason).toBe("이 길의 토요일 막차는 아직 준비 중이에요.");
    // 평일도 일부 노선만 계산한 요일 종류일 수 있다(9호선을 끈 동안): 이유는 길 쪽으로 말한다.
    expect(view({ ...weekday, partial: true }, [check]).checkReason).toBe("이 길은 아직 막차를 계산하지 않아요.");
    expect(view(weekday, [check]).notice).toBeNull();
  });

  it("계산하지 못한 응답: 이유를 맨 위에 한 번 말하고, 요일 표제·일부 노선·'계산했어요'는 없다", () => {
    const reasons = {
      stale: "시간표가 오래돼 막차를 보여 드리지 못해요.",
      date_out_of_range: "이 날짜는 공휴일인지 아직 알 수 없어 막차를 보여 드리지 못해요.",
      day_unknown: "약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라 보여 드리지 못해요.",
    } as const;
    for (const [unavailable, reason] of Object.entries(reasons)) {
      // 서버는 요일을 몰라도 기본값(평일)과 그 요일의 partial을 같이 준다. 화면은 쓰지 않는다.
      const found = view({ ...weekday, partial: true, unavailable: unavailable as keyof typeof reasons }, [
        check,
        check,
      ]);
      expect(found.notice, unavailable).toBe(reason);
      expect(found.dayLabel, unavailable).toBeNull();
      expect(found.lead, unavailable).toBeNull();
      expect(found.partialNote, unavailable).toBeNull();
      // 이유는 맨 위에 한 번만: 줄마다 되풀이하지 않는다(줄에는 지도 앱 버튼만 남는다).
      expect(found.checkReason, unavailable).toBeNull();
      expect(found.rows.map((r) => r.state.kind)).toEqual(["check", "check"]);
      // asOf는 시간표를 모은 날이다(적용일이 아니다): 계산하지 못한 응답에도 맞는 말로 적는다.
      expect(found.footnote, unavailable).toBe("시간표 수집 기준 2026년 11월 16일.");
    }
  });

  it("일부 노선만 계산한 요일 종류면 줄의 종류와 상관없이 그 사실을 한 줄로 알린다", () => {
    expect(view(weekday, [check]).partialNote).toBeNull();
    // 모두 시각이 있어도 알린다(#83 검토): 안내 기준은 그 요일 종류 전체의 partial이다.
    expect(view({ ...weekday, partial: true }, [direct(1443), transfer(1389)]).partialNote).toBe(
      "평일은 일부 노선만 막차를 보여 드려요.",
    );
    expect(view({ ...weekday, partial: true }, [check]).partialNote).toBe("평일은 일부 노선만 막차를 보여 드려요.");
    expect(view({ dayType: "saturday", asOf: "2026-11-16", partial: true }, [direct(1407)]).partialNote).toBe(
      "토요일은 일부 노선만 막차를 보여 드려요.",
    );
    expect(view({ dayType: "holiday", asOf: "2026-11-16", partial: true }, [check]).partialNote).toBe(
      "일요일·공휴일은 일부 노선만 막차를 보여 드려요.",
    );
  });

  it("공통 안내는 시간표를 모은 날, 달라질 수 있다는 것, 걷는 시간을 말한다", () => {
    expect(view(weekday, [check]).footnote).toBe(
      "시간표 수집 기준 2026년 11월 16일. 공사나 행사가 있으면 달라질 수 있으니 타기 전에 한 번 더 확인해 주세요. 승강장까지 걷는 시간은 따로 잡아 주세요.",
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

  it("모두 숨겼고 내가 그중 하나가 아니면 줄 없이 '본인 화면에서만 보여요'만 남긴다", () => {
    const people = [person(0, "참가자 1", { hidden: true }), person(1, "참가자 2", { hidden: true })];
    // 계산하지 못한 응답이어도 같다: 숨긴 사람들에 대해 아무것도(이유·요일·기준일) 말하지 않는다.
    for (const basis of [weekday, { ...weekday, partial: true }, { ...weekday, unavailable: "day_unknown" } as Basis]) {
      expect(toLastTrainView(basis, [], station, people)).toEqual({
        stationName: "강남역",
        dayLabel: null,
        notice: null,
        lead: null,
        rows: [],
        checkReason: null,
        partialNote: null,
        hiddenOthers: true,
        footnote: null,
      });
    }
    // 사람이 없으면(숨긴 사람도 없으면) 칸이 없다.
    expect(toLastTrainView(weekday, [], station, [])).toBeNull();
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
    const changing = lastTrainState(transfer(1389));
    const single = lastTrainState({
      kind: "margin",
      minute: 1425,
      transfer: false,
      boundFor: { stationCode: "7sw", stationName: "김포공항" },
    });
    if (changing?.kind !== "margin" || single?.kind !== "margin") throw new Error("여유 시각 없음");
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
      // 약속이 없는 화면과 새벽 약속(약속 전에 떠나는 줄) 둘 다 본다.
      return [undefined, { date: "2026-11-28", time: "02:59" }].flatMap((meeting) => {
        const found = view(basis, [direct(1443), transfer(1389), check], undefined, meeting);
        const notes = found.rows.flatMap((r) => {
          if (r.state.kind === "margin") return [marginNote(r.state)];
          return r.state.kind === "gone" ? [r.state.text] : [];
        });
        return [found.notice, found.lead, found.checkReason, found.partialNote, found.footnote, ...notes];
      });
    });
    for (const word of ["손해", "억울", "AI", "정확한"]) expect(texts.join("\n")).not.toContain(word);
  });
});

describe("약속 날짜·시각을 아는 방: 실제 달력 날짜로 본다(#83 검토)", () => {
  // 강남·부천 방의 신도림: 금요일 운행일의 강남 방면 직행 막차가 24:27(1467분, 삼성행), 토요일 운행일에는 23:27(1407분)이다.
  const samseong = (minute: number) => direct(minute, "삼성");

  it("토요일 02:59 약속은 금요일 운행일이다: 토요일 00:27 막차는 약속보다 먼저 떠나므로 귀가 시각으로 보이지 않는다", () => {
    const meeting = { date: "2026-11-28", time: "02:59" };
    expect(lastTrainState(samseong(1467), meeting)).toEqual({
      kind: "gone",
      atMeeting: false,
      source: "direct",
      text: "11월 28일 00:27 막차는 약속 전에 떠나요.",
    });
    const found = view(weekday, [samseong(1467), transfer(1446)], undefined, meeting);
    expect(found.rows.map((r) => r.state.kind)).toEqual(["gone", "gone"]);
    // 여유 시각은 실제 막차가 아니다: "약속 전에 떠난다"고 단정하지 않는다.
    expect(found.rows[1]?.state).toMatchObject({
      source: "margin",
      text: "넉넉히 잡으면 11월 28일 00:00엔 떠나야 해서 약속 시각보다 일러요. 실제 막차는 이보다 늦을 수 있어요.",
    });
    // 맨 위 줄도 같은 기준: "다음 날 00:27 전에 나서야 해요"라고 하지 않는다.
    expect(found.lead).toBe("약속 전에 막차가 떠나는 분이 있어요.");
    expect(JSON.stringify(found)).not.toContain("다음 날");
    expect(JSON.stringify(found)).not.toContain("나서야");
    // 지도 앱 버튼은 남는다(돌아갈 다른 길을 찾아볼 수 있게).
    expect(found.rows[0]?.mapUrl).not.toBeNull();
    // 공유 그림에도 줄이 없다.
    expect(lastTrainCardLine(lastTrainState(samseong(1467), meeting), OG_TEXT)).toBeNull();
    expect(lastTrainCardLine(lastTrainState(transfer(1446), meeting), OG_TEXT)).toBeNull();
  });

  it("같은 날 03:00 약속은 토요일 운행일이다: 그날 밤 23:27 막차를 그대로 보인다", () => {
    const meeting = { date: "2026-11-28", time: "03:00" };
    expect(lastTrainState(samseong(1407), meeting)).toMatchObject({ kind: "direct", clock: "23:27", nextDay: false });
    const found = view(
      { dayType: "saturday", asOf: "2026-11-16", partial: true },
      [samseong(1407)],
      undefined,
      meeting,
    );
    expect(found.lead).toBe("민수는 23:27 전에 나서야 해요");
    expect(lastTrainCardLine(lastTrainState(samseong(1407), meeting), OG_TEXT)).toBe("막차 23:27");
    // 토요일 운행일의 24:27은 일요일 00:27이다: 약속일의 다음 날.
    expect(lastTrainState(samseong(1467), meeting)).toMatchObject({ kind: "direct", clock: "00:27", nextDay: true });
  });

  it("전날 밤에 떠나는 열차는 그 날짜로 말한다", () => {
    // 토요일 01:00 약속(금요일 운행일), 금요일 23:50 막차.
    expect(lastTrainState(direct(1430), { date: "2026-11-28", time: "01:00" })).toMatchObject({
      kind: "gone",
      text: "11월 27일 23:50 막차는 약속 전에 떠나요.",
    });
  });

  it("새벽 약속 뒤에 떠나는 열차는 약속일과 같은 날이다: '다음 날'을 붙이지 않는다", () => {
    const meeting = { date: "2026-11-28", time: "00:10" };
    expect(lastTrainState(samseong(1467), meeting)).toMatchObject({ kind: "direct", clock: "00:27", nextDay: false });
    const found = view(weekday, [samseong(1467), transfer(1389)], undefined, meeting);
    // 민수는 약속 뒤(00:27), 지연의 여유 시각(금요일 23:00)은 약속 전이다.
    expect(found.rows.map((r) => r.state.kind)).toEqual(["direct", "gone"]);
    expect(found.lead).toBe("막차가 약속 시각보다 이를 수 있는 분이 있어요.");
    expect(lastTrainCardLine(lastTrainState(samseong(1467), meeting), OG_TEXT)).toBe("막차 00:27");
  });

  it("약속과 같은 분에 떠나는 열차도 탈 수 없다: 약속을 시작하는 순간 떠난다(경계는 '출발 ≤ 약속')", () => {
    const meeting = { date: "2026-11-28", time: "23:00" };
    // 22:59는 약속 전, 23:00은 약속 시각, 23:01부터 귀갓길에 탈 수 있다.
    expect(lastTrainState(direct(1379), meeting)).toEqual({
      kind: "gone",
      atMeeting: false,
      source: "direct",
      text: "11월 28일 22:59 막차는 약속 전에 떠나요.",
    });
    expect(lastTrainState(direct(1380), meeting)).toEqual({
      kind: "gone",
      atMeeting: true,
      source: "direct",
      text: "11월 28일 23:00 막차는 약속 시각에 떠나요.",
    });
    expect(lastTrainState(direct(1381), meeting)).toMatchObject({ kind: "direct", clock: "23:01", nextDay: false });
    // 여유 시각은 보이는 시각(10분 단위로 내린 값)으로 견준다: 23:09는 23:00으로 보여 약속과 같고, 23:10은 약속 뒤다.
    expect(lastTrainState(transfer(1389), meeting)).toEqual({
      kind: "gone",
      atMeeting: true,
      source: "margin",
      text: "넉넉히 잡으면 11월 28일 23:00엔 떠나야 해서 약속 시각과 같아요. 실제 막차는 이보다 늦을 수 있어요.",
    });
    expect(lastTrainState(transfer(1390), meeting)).toMatchObject({ kind: "margin", clock: "23:10" });
    expect(lastTrainState(transfer(1389), { date: "2026-11-28", time: "23:05" })).toMatchObject({
      kind: "gone",
      atMeeting: false,
    });
    // 새벽 약속(전날 운행일)의 같은 분: 토요일 00:27 약속과 금요일 운행일의 24:27.
    expect(lastTrainState(samseong(1467), { date: "2026-11-28", time: "00:27" })).toMatchObject({
      kind: "gone",
      text: "11월 28일 00:27 막차는 약속 시각에 떠나요.",
    });
    expect(lastTrainState(samseong(1467), { date: "2026-11-28", time: "00:26" })).toMatchObject({ kind: "direct" });
    // 공유 그림에도 같은 분의 열차는 그리지 않는다.
    expect(lastTrainCardLine(lastTrainState(direct(1380), meeting), OG_TEXT)).toBeNull();
    expect(lastTrainCardLine(lastTrainState(direct(1381), meeting), OG_TEXT)).toBe("막차 23:01");
  });

  it("맨 위 줄: 모두 약속과 같은 분이면 '약속 시각', 약속 전에 떠나는 줄이 섞이면 '약속 전'이라고 말한다", () => {
    const meeting = { date: "2026-11-28", time: "23:00" };
    expect(view(weekday, [direct(1380), direct(1443)], undefined, meeting).lead).toBe(
      "약속 시각에 막차가 떠나는 분이 있어요.",
    );
    expect(view(weekday, [direct(1380), direct(1379)], undefined, meeting).lead).toBe(
      "약속 전에 막차가 떠나는 분이 있어요.",
    );
    // 여유 시각만 걸리면 단정하지 않는다.
    expect(view(weekday, [transfer(1389), direct(1443)], undefined, meeting).lead).toBe(
      "막차가 약속 시각 무렵일 수 있는 분이 있어요.",
    );
    expect(view(weekday, [transfer(1379), direct(1443)], undefined, meeting).lead).toBe(
      "막차가 약속 시각보다 이를 수 있는 분이 있어요.",
    );
    // 같은 분의 열차는 "나서야 해요"의 시각으로 쓰지 않는다.
    expect(JSON.stringify(view(weekday, [direct(1380), direct(1443)], undefined, meeting))).not.toContain("23시 전에");
  });

  it("낮·저녁 약속과 시각 없이 시간대만 고른 방은 예전과 같다(자정을 넘기면 '다음 날')", () => {
    for (const meeting of [
      { date: "2026-11-28", time: "19:00" },
      { date: "2026-11-28", time: null },
    ]) {
      const found = view(weekday, [direct(1443), transfer(1389)], undefined, meeting);
      expect(found.rows.map((r) => r.state.kind)).toEqual(["direct", "margin"]);
      expect(found.rows[0]?.state).toMatchObject({ clock: "00:03", nextDay: true });
      expect(found.lead).toBe("지연은 23시 전에 나서야 해요");
    }
  });

  it("숨긴 본인의 줄이 약속 전에 떠나도 공용 문구(맨 위 줄)에는 쓰지 않는다", () => {
    const people = [person(0, "민수"), person(1, "참가자 2", { hidden: true, isSelf: true })];
    const found = view(weekday, [samseong(1467), transfer(1389)], people, { date: "2026-11-28", time: "00:10" });
    expect(found.rows.map((r) => r.state.kind)).toEqual(["direct", "gone"]);
    expect(found.lead).toBe("민수는 00:27 전에 나서야 해요");
  });
});

describe("공유 그림의 막차 줄", () => {
  it("직행 확정은 '막차 23:52', 여유 시각은 '늦어도 23:00', 시각이 없으면 줄이 없다", () => {
    expect(lastTrainCardLine(lastTrainState(direct(1432)), OG_TEXT)).toBe("막차 23:52");
    expect(lastTrainCardLine(lastTrainState(transfer(1389)), OG_TEXT)).toBe("늦어도 23:00");
    expect(lastTrainCardLine(lastTrainState(check), OG_TEXT)).toBeNull();
  });

  it("자정을 넘기면 그림에서도 '다음 날'을 붙인다(그림만 보면 '00:03'이 그날 새벽으로 읽힌다)", () => {
    expect(lastTrainCardLine(lastTrainState(direct(1443)), OG_TEXT)).toBe("막차 다음 날 00:03");
    expect(lastTrainCardLine(lastTrainState(transfer(1449)), OG_TEXT)).toBe("늦어도 다음 날 00:00");
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

  it("방의 약속을 넘기면 후보의 막차 칸이 약속보다 먼저 떠나는 열차를 가려낸다", () => {
    const dawn = toResultView(result, { meeting: { date: "2026-11-28", time: "02:59" } }).candidates[0]?.lastTrain;
    expect(dawn?.rows.map((r) => r.state.kind)).toEqual(["gone", "gone"]);
    expect(dawn?.rows[0]?.state).toMatchObject({ text: "11월 28일 00:03 막차는 약속 전에 떠나요." });
    const after = toResultView(result, { meeting: { date: "2026-11-28", time: "03:00" } }).candidates[0]?.lastTrain;
    expect(after?.rows.map((r) => r.state.kind)).toEqual(["direct", "margin"]);
    expect(after?.lead).toBe("부천은 23시 전에 나서야 해요");
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
