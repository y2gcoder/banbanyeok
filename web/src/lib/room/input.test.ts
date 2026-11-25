import { describe, expect, it } from "vitest";
import { searchStations } from "../stations";
import { type CreateRoomForm, toCreateRoomRequest, toOutcomeAnswer, toParticipantInput } from "./input";

const station = (name: string) => {
  const found = searchStations(name).find((s) => s.name === name && s.supported);
  if (!found) throw new Error(`테스트 역이 없다: ${name}`);
  return found;
};
const gangnam = station("강남");
const TODAY = "2026-11-15";

describe("참여 입력", () => {
  it("이름은 앞뒤 공백을 빼고, 비면 보내지 않으며, hidden은 항상 보낸다", () => {
    expect(toParticipantInput({ nickname: "  민수 ", station: gangnam, hidden: false })).toEqual({
      ok: true,
      value: { originCode: gangnam.code, hidden: false, nickname: "민수" },
    });
    expect(toParticipantInput({ nickname: "   ", station: gangnam, hidden: true })).toEqual({
      ok: true,
      value: { originCode: gangnam.code, hidden: true },
    });
  });

  it("출발역이 없거나 계산할 수 없는 역이면 거부한다", () => {
    expect(toParticipantInput({ nickname: "", station: null, hidden: false })).toMatchObject({ ok: false });
    expect(
      toParticipantInput({ nickname: "", station: { ...gangnam, supported: false }, hidden: false }),
    ).toMatchObject({
      ok: false,
    });
  });

  it("이름은 코드포인트 20자까지(이모지 20개는 통과, 21개는 거부), 제어 문자·짝 없는 서로게이트는 거부", () => {
    const emoji = (n: number) => "🙂".repeat(n);
    expect(toParticipantInput({ nickname: emoji(20), station: gangnam, hidden: false }).ok).toBe(true);
    expect(toParticipantInput({ nickname: emoji(21), station: gangnam, hidden: false }).ok).toBe(false);
    expect(toParticipantInput({ nickname: "a\u0007b", station: gangnam, hidden: false }).ok).toBe(false);
    expect(toParticipantInput({ nickname: "a\ud800", station: gangnam, hidden: false }).ok).toBe(false);
  });
});

describe("방 만들기 본문", () => {
  const form = (patch: Partial<CreateRoomForm> = {}): CreateRoomForm => ({
    host: { nickname: "", station: gangnam, hidden: false },
    mode: "fair",
    meetingDate: "",
    meetingTime: "",
    meetingBand: null,
    expectedCount: null,
    ...patch,
  });

  it("기본은 mode와 host만 보낸다", () => {
    expect(toCreateRoomRequest(form(), TODAY)).toEqual({
      ok: true,
      value: { mode: "fair", host: { originCode: gangnam.code, hidden: false } },
    });
  });

  it("배려 모드는 favorTarget: host, 약속일·예상 인원은 넣었을 때만", () => {
    expect(toCreateRoomRequest(form({ mode: "favor", meetingDate: "2026-11-20", expectedCount: 3 }), TODAY)).toEqual({
      ok: true,
      value: {
        mode: "favor",
        favorTarget: "host",
        meetingDate: "2026-11-20",
        expectedCount: 3,
        host: { originCode: gangnam.code, hidden: false },
      },
    });
  });

  it("'누구 쪽으로'를 뽑기로 정하면 favorTarget: draw, 다른 기준에는 대상을 보내지 않는다(#172)", () => {
    const drawn = toCreateRoomRequest(form({ mode: "favor", favorTarget: "draw" }), TODAY);
    expect(drawn.ok && drawn.value.favorTarget).toBe("draw");
    const fair = toCreateRoomRequest(form({ mode: "fair", favorTarget: "draw" }), TODAY);
    expect(fair.ok && "favorTarget" in fair.value).toBe(false);
  });

  it("약속일은 오늘~30일 안의 실제 날짜만(오늘은 가능, 어제·31일 뒤·없는 날짜는 거부)", () => {
    expect(toCreateRoomRequest(form({ meetingDate: TODAY }), TODAY).ok).toBe(true);
    expect(toCreateRoomRequest(form({ meetingDate: "2026-12-15" }), TODAY).ok).toBe(true);
    expect(toCreateRoomRequest(form({ meetingDate: "2026-11-14" }), TODAY).ok).toBe(false);
    expect(toCreateRoomRequest(form({ meetingDate: "2026-12-16" }), TODAY).ok).toBe(false);
    expect(toCreateRoomRequest(form({ meetingDate: "2026-02-30" }), TODAY).ok).toBe(false);
  });

  it("약속 시각은 HH:MM일 때만 보낸다", () => {
    expect(toCreateRoomRequest(form({ meetingDate: TODAY, meetingTime: "19:30" }), TODAY)).toMatchObject({
      ok: true,
      value: { meetingDate: TODAY, meetingTime: "19:30" },
    });
    expect(toCreateRoomRequest(form({ meetingTime: "08:05" }), TODAY)).toMatchObject({
      ok: true,
      value: { meetingTime: "08:05" },
    });
    expect(toCreateRoomRequest(form(), TODAY)).not.toHaveProperty("value.meetingTime");
    expect(toCreateRoomRequest(form({ meetingTime: "24:00" }), TODAY).ok).toBe(false);
    expect(toCreateRoomRequest(form({ meetingTime: "7:30" }), TODAY).ok).toBe(false);
  });

  it("시간대만 고르면 meetingBand만 보내고, 시각이 있으면 시각만 보낸다(가짜 시각을 만들지 않는다)", () => {
    const banded = toCreateRoomRequest(form({ meetingDate: TODAY, meetingBand: "evening" }), TODAY);
    expect(banded).toMatchObject({ ok: true, value: { meetingDate: TODAY, meetingBand: "evening" } });
    expect(banded).not.toHaveProperty("value.meetingTime");
    const timed = toCreateRoomRequest(form({ meetingTime: "19:30", meetingBand: "evening" }), TODAY);
    expect(timed).toMatchObject({ ok: true, value: { meetingTime: "19:30" } });
    expect(timed).not.toHaveProperty("value.meetingBand");
  });

  it("예상 인원은 2~4명", () => {
    expect(toCreateRoomRequest(form({ expectedCount: 5 }), TODAY).ok).toBe(false);
    expect(toCreateRoomRequest(form({ expectedCount: 1 }), TODAY).ok).toBe(false);
  });
});

describe("실제로 어디서 만났나", () => {
  it("1위·2~3위·못 만남은 역 없이, 다른 곳은 역과 함께", () => {
    expect(toOutcomeAnswer({ kind: "top1" })).toEqual({ ok: true, value: { outcome: "top1" } });
    expect(toOutcomeAnswer({ kind: "top3" })).toEqual({ ok: true, value: { outcome: "top3" } });
    expect(toOutcomeAnswer({ kind: "none" })).toEqual({ ok: true, value: { outcome: "none" } });
    expect(toOutcomeAnswer({ kind: "other", station: gangnam })).toEqual({
      ok: true,
      value: { outcome: "other", stationCode: gangnam.code },
    });
    expect(toOutcomeAnswer({ kind: "other", station: null }).ok).toBe(false);
  });
});
