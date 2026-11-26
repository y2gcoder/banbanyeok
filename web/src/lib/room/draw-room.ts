/**
 * 혼자 입력한 결과(`ShareState`)를 사다리 방 만들기 요청으로 옮긴다(#227, ADR-0011). 고른 사람이 방장이 되고 나머지는 방장이 대신
 * 넣은 칸(`others`)이다. 입력 순서는 `hostPosition`으로 그대로 남는다. 이름이 없는 줄은 이름 없이 보내고, 표시 이름은 서버가 만든다.
 */
import type { DrawRoomCreateRequest, ParticipantInput } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import { dayAfter, MAX_MEETING_DAYS } from "@/lib/when/dates";
import { type Band, slotForMeeting, splitSlot, type TimeSlot } from "@/lib/when/time-slot";

export type DrawRoomMeeting = { meetingDate: string | null; meetingBand: Band | null };

/**
 * 결과의 구분(요일 유형 × 시간대)을 방의 약속 칸으로. 방은 날짜가 없으면 평일이라, 평일은 시간대만 둔다. 토요일·일요일·공휴일은
 * 오늘부터 그 요일 유형이 되는 가장 가까운 날을 약속일로 둔다(방은 약속 다음 날 사라진다). 옛 링크(구분을 고른 적 없음)는 비워 둔다.
 */
export function meetingForSlot(slot: TimeSlot, today: string, slotDefaulted = false): DrawRoomMeeting {
  if (slotDefaulted) return { meetingDate: null, meetingBand: null };
  const { day, band } = splitSlot(slot);
  if (day === "weekday") return { meetingDate: null, meetingBand: band };
  for (let offset = 0; offset < MAX_MEETING_DAYS; offset += 1) {
    const date = dayAfter(today, offset);
    if (slotForMeeting(date, null, band) === slot) return { meetingDate: date, meetingBand: band };
  }
  throw new RangeError(`no ${slot} within ${MAX_MEETING_DAYS} days of ${today}`);
}

function participantAt(state: ShareState, index: number): ParticipantInput {
  const nickname = state.nicknames?.[index]?.trim();
  const originCode = state.origins[index] ?? "";
  return nickname ? { nickname, originCode, hidden: false } : { originCode, hidden: false };
}

/** [hostIndex]는 결과의 입력 순서에서 "나"의 자리. */
export function toDrawRoomRequest(state: ShareState, hostIndex: number, today: string): DrawRoomCreateRequest {
  if (hostIndex < 0 || hostIndex >= state.origins.length) throw new RangeError("hostIndex");
  const { meetingDate, meetingBand } = meetingForSlot(state.timeSlot, today, state.slotDefaulted === true);
  return {
    host: participantAt(state, hostIndex),
    others: state.origins
      .map((_, index) => index)
      .filter((index) => index !== hostIndex)
      .map((index) => participantAt(state, index)),
    hostPosition: hostIndex,
    ...(meetingDate ? { meetingDate } : {}),
    ...(meetingBand ? { meetingBand } : {}),
  };
}
