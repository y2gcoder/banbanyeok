/** 방 응답을 화면 값으로. 이름은 서버 label을 그대로 쓰고, 보는 사람 표시("(나)")만 화면이 붙인다. */
import type { Room } from "@/lib/api/types";
import { MAX_PEOPLE } from "@/lib/link/codec";
import type { RoomRecord } from "./tokens";

export type RoomPerson = {
  id: string;
  /** 서버가 만든 표시 이름(label). */
  name: string;
  /** 출발역 이름. 가린 사람은 "출발역 비공개", 본인이 가린 경우는 본인에게만 보인다는 안내를 덧붙인다. */
  originText: string;
  isSelf: boolean;
  isHost: boolean;
  hidden: boolean;
};

export function roomPeople(room: Room): RoomPerson[] {
  return room.participants.map((p) => ({
    id: p.participantId,
    name: p.label,
    originText: p.originName
      ? p.hidden && p.isSelf
        ? `${p.originName} · 나에게만 보여요`
        : p.originName
      : "출발역 비공개",
    isSelf: p.isSelf === true,
    isHost: p.isHost === true,
    hidden: p.hidden,
  }));
}

/** 이 사람이 방에 참여한 상태인지(내 토큰이 이 방의 어떤 항목과 맞는지)로 정한다. */
export type JoinState = "joined" | "can-join" | "locked" | "full";

export function joinState(room: Room): JoinState {
  if (room.participants.some((p) => p.isSelf === true)) return "joined";
  if (room.participants.length >= MAX_PEOPLE) return "full";
  if (room.locked) return "locked";
  return "can-join";
}

/** 기록에는 참여자 토큰이 있는데 방에는 내 항목이 없다(내보내졌거나 지워짐). 토큰을 정리해야 한다. */
export function hasStaleParticipantToken(room: Room, record: RoomRecord | null): boolean {
  return Boolean(record?.participantToken) && !room.participants.some((p) => p.isSelf === true);
}

/** 방의 기본 배려 대상이 방 참가자 중 몇 번째인지(없으면 null). 서버는 `favorTarget`에 참여자 ID를 준다. */
export function favorIndexOf(room: Room): number | null {
  if (room.mode !== "favor" || !room.favorTarget) return null;
  const index = room.participants.findIndex((p) => p.participantId === room.favorTarget);
  return index < 0 ? null : index;
}
