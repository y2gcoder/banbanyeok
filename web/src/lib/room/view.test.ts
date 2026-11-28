import { describe, expect, it } from "vitest";
import type { Room, RoomParticipant } from "@/lib/api/types";
import { favorIndexOf, hasStaleParticipantToken, joinState, roomPeople } from "./view";

const person = (patch: Partial<RoomParticipant> & { participantId: string }): RoomParticipant => ({
  hidden: false,
  originCode: "03v",
  originName: "강남",
  label: "강남에서 오는 분",
  labelKind: "origin",
  shortLabel: "강남",
  isHost: false,
  isSelf: false,
  ...patch,
});

const room = (participants: RoomParticipant[], patch: Partial<Room> = {}): Room => ({
  roomId: "qt7yvmsht3",
  mode: "fair",
  locked: false,
  expiresAt: "2026-11-22T00:00:00Z",
  dataVersion: "20261114.3",
  participants,
  ...patch,
});

describe("방 화면 값", () => {
  it("서버 label과 출발역 이름을 그대로 쓴다", () => {
    const view = roomPeople(
      room([
        person({ participantId: "a", label: "민수", labelKind: "name", isHost: true }),
        person({
          participantId: "b",
          originCode: null,
          originName: null,
          label: "참가자 2",
          labelKind: "ordinal",
        }),
        person({ participantId: "c", isSelf: true, label: "참가자 3", labelKind: "ordinal" }),
      ]),
    );
    expect(view.map((p) => p.name)).toEqual(["민수", "참가자 2", "참가자 3"]);
    expect(view.map((p) => p.originText)).toEqual(["강남", "출발역 정보 없음", "강남"]);
    expect(view.map((p) => p.isSelf)).toEqual([false, false, true]);
    expect(view[0]?.isHost).toBe(true);
  });

  it("참여 상태: 내 항목이 있으면 joined, 없으면 정원·잠김·참여 가능 순으로", () => {
    const a = person({ participantId: "a" });
    const mine = person({ participantId: "m", isSelf: true });
    expect(joinState(room([a, mine]))).toBe("joined");
    expect(joinState(room([a], { locked: true }))).toBe("locked");
    const four = ["a", "b", "c", "d"].map((participantId) => person({ participantId }));
    expect(joinState(room(four))).toBe("full");
    expect(joinState(room(four, { locked: true }))).toBe("full");
    expect(joinState(room([a]))).toBe("can-join");
    // 잠겼어도 이미 들어온 사람은 joined(수정·삭제를 할 수 있어야 한다)
    expect(joinState(room([mine], { locked: true }))).toBe("joined");
  });

  it("기록에 참여자 토큰이 있는데 내 항목이 방에 없으면 낡은 토큰", () => {
    const a = person({ participantId: "a" });
    const record = { v: 1 as const, participantToken: "t", keepUntil: "2026-12-15T00:00:00Z" };
    expect(hasStaleParticipantToken(room([a]), record)).toBe(true);
    expect(hasStaleParticipantToken(room([person({ participantId: "m", isSelf: true })]), record)).toBe(false);
    expect(hasStaleParticipantToken(room([a]), { ...record, participantToken: undefined })).toBe(false);
    expect(hasStaleParticipantToken(room([a]), null)).toBe(false);
  });

  it("기본 배려 대상은 서버 favorTarget(참여자 ID)의 순서", () => {
    const people = [person({ participantId: "a" }), person({ participantId: "b" })];
    expect(favorIndexOf(room(people, { mode: "favor", favorTarget: "b" }))).toBe(1);
    expect(favorIndexOf(room(people, { mode: "favor", favorTarget: "zzz" }))).toBeNull();
    expect(favorIndexOf(room(people, { mode: "fair", favorTarget: "b" }))).toBeNull();
  });
});
