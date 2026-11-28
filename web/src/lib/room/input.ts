/**
 * 방 입력 검증과 요청 본문. 규칙은 서버(`RoomService`)와 계약을 따른다: 이름은 앞뒤 공백을 빼고 비어 있으면 보내지 않고
 * (코드포인트 20자 이하, 짝 없는 서로게이트·제어 문자 불가), 출발역은 계산할 수 있는 역이어야 한다.
 * 표시 이름(label)은 서버가 만든다. 여기서는 만들지 않는다.
 */
import type { Mode, OutcomeAnswer, ParticipantInput, RoomCreateRequest } from "@/lib/api/types";
import { codePointLength, MAX_NICKNAME_CODE_POINTS, MAX_PEOPLE, MIN_PEOPLE } from "@/lib/link/codec";
import type { Station } from "@/lib/stations";
import { isMeetingDateInRange } from "@/lib/when/dates";
import type { Band } from "@/lib/when/time-slot";

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export type ParticipantFormValue = { nickname: string; station: Station | null };

// biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자를 막으려는 검사다.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

function checkNickname(raw: string): Checked<string | null> {
  const nickname = raw.trim();
  if (nickname === "") return { ok: true, value: null };
  if (codePointLength(nickname) > MAX_NICKNAME_CODE_POINTS)
    return { ok: false, message: `이름은 ${MAX_NICKNAME_CODE_POINTS}자까지 쓸 수 있어요.` };
  if (!nickname.isWellFormed() || CONTROL.test(nickname)) return { ok: false, message: "쓸 수 없는 글자가 있어요." };
  return { ok: true, value: nickname };
}

/** 이름은 넣은 사람만 보낸다. */
export function toParticipantInput(form: ParticipantFormValue): Checked<ParticipantInput> {
  const nickname = checkNickname(form.nickname);
  if (!nickname.ok) return nickname;
  if (!form.station) return { ok: false, message: "출발역을 골라 주세요." };
  if (!form.station.supported) return { ok: false, message: "계산할 수 없는 역이에요. 다른 역을 골라 주세요." };
  return {
    ok: true,
    value: {
      originCode: form.station.code,
      ...(nickname.value ? { nickname: nickname.value } : {}),
    },
  };
}

/** 계약의 MeetingTime(`HH:MM`, 24시간). `<input type="time">`은 이 형식을 준다. */
const MEETING_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** '누구 쪽으로'(favor) 방의 대상: 방장(나), 또는 방장이 나중에 뽑는다(#172). */
export type FavorTargetChoice = "host" | "draw";

export type CreateRoomForm = {
  host: ParticipantFormValue;
  mode: Mode;
  /** `mode`가 favor일 때 대상. 없으면 방장. */
  favorTarget?: FavorTargetChoice;
  /** `YYYY-MM-DD` 또는 빈 문자열(약속일 없음). */
  meetingDate: string;
  /** `HH:MM` 또는 빈 문자열(약속 시각 없음). 결과를 어느 시간대 기준으로 계산할지 정한다. */
  meetingTime: string;
  /**
   * 시각 없이 고른 시간대(아침·낮·저녁·밤) 또는 null. 시각이 있으면 보내지 않는다(서버가 시각에서 정한다).
   * 가짜 시각(예: 저녁 → 19:00)을 만들어 보내지 않으려고 따로 둔다.
   */
  meetingBand: Band | null;
  /** 예상 인원(2~4) 또는 null(정하지 않음). */
  expectedCount: number | null;
};

/** 방 만들기 본문. 배려 모드는 방을 만들 때 대상이 방장(`host`)이거나 나중에 뽑기(`draw`)다. */
export function toCreateRoomRequest(form: CreateRoomForm, today: string): Checked<RoomCreateRequest> {
  const host = toParticipantInput(form.host);
  if (!host.ok) return host;
  if (form.meetingDate !== "" && !isMeetingDateInRange(form.meetingDate, today))
    return { ok: false, message: "약속일은 오늘부터 30일 안에서 골라 주세요." };
  if (form.meetingTime !== "" && !MEETING_TIME.test(form.meetingTime))
    return { ok: false, message: "약속 시각을 다시 골라 주세요." };
  if (form.expectedCount !== null && (form.expectedCount < MIN_PEOPLE || form.expectedCount > MAX_PEOPLE))
    return { ok: false, message: `예상 인원은 ${MIN_PEOPLE}~${MAX_PEOPLE}명으로 정해 주세요.` };
  return {
    ok: true,
    value: {
      mode: form.mode,
      host: host.value,
      ...(form.mode === "favor" ? { favorTarget: form.favorTarget ?? "host" } : {}),
      ...(form.meetingDate !== "" ? { meetingDate: form.meetingDate } : {}),
      ...(form.meetingTime !== "" ? { meetingTime: form.meetingTime } : {}),
      ...(form.meetingTime === "" && form.meetingBand !== null ? { meetingBand: form.meetingBand } : {}),
      ...(form.expectedCount !== null ? { expectedCount: form.expectedCount } : {}),
    },
  };
}

export type OutcomeChoice =
  | { kind: "top1" }
  | { kind: "top3" }
  | { kind: "other"; station: Station | null }
  | { kind: "none" };

/** "실제로 어디서 만났나" 응답 본문. 다른 곳이면 역이 필요하다. */
export function toOutcomeAnswer(choice: OutcomeChoice): Checked<OutcomeAnswer> {
  if (choice.kind !== "other") return { ok: true, value: { outcome: choice.kind } };
  if (!choice.station) return { ok: false, message: "만난 역을 골라 주세요." };
  return { ok: true, value: { outcome: "other", stationCode: choice.station.code } };
}
