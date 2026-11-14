/**
 * 방 입력 검증과 요청 본문. 규칙은 서버(`RoomService`)와 계약을 따른다: 이름은 앞뒤 공백을 빼고 비어 있으면 보내지 않고
 * (코드포인트 20자 이하, 짝 없는 서로게이트·제어 문자 불가), 출발역은 계산할 수 있는 역이어야 한다.
 * 표시 이름(label)은 서버가 만든다. 여기서는 만들지 않는다.
 */
import type { Mode, OutcomeAnswer, ParticipantInput, RoomCreateRequest } from "@/lib/api/types";
import { codePointLength, MAX_NICKNAME_CODE_POINTS, MAX_PEOPLE, MIN_PEOPLE } from "@/lib/link/codec";
import type { Station } from "@/lib/stations";
import { isMeetingDateInRange } from "./dates";

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

export type ParticipantFormValue = { nickname: string; station: Station | null; hidden: boolean };

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

/** 이름은 넣은 사람만 보낸다. `hidden`은 항상 보낸다(꺼 둔 값도 명시). */
export function toParticipantInput(form: ParticipantFormValue): Checked<ParticipantInput> {
  const nickname = checkNickname(form.nickname);
  if (!nickname.ok) return nickname;
  if (!form.station) return { ok: false, message: "출발역을 골라 주세요." };
  if (!form.station.supported) return { ok: false, message: "계산할 수 없는 역이에요. 다른 역을 골라 주세요." };
  return {
    ok: true,
    value: {
      originCode: form.station.code,
      hidden: form.hidden,
      ...(nickname.value ? { nickname: nickname.value } : {}),
    },
  };
}

export type CreateRoomForm = {
  host: ParticipantFormValue;
  mode: Mode;
  /** `YYYY-MM-DD` 또는 빈 문자열(약속일 없음). */
  meetingDate: string;
  /** 예상 인원(2~4) 또는 null(정하지 않음). */
  expectedCount: number | null;
};

/** 방 만들기 본문. 배려 모드는 방을 만들 때 대상이 방장뿐이므로 `favorTarget: "host"`다. */
export function toCreateRoomRequest(form: CreateRoomForm, today: string): Checked<RoomCreateRequest> {
  const host = toParticipantInput(form.host);
  if (!host.ok) return host;
  if (form.meetingDate !== "" && !isMeetingDateInRange(form.meetingDate, today))
    return { ok: false, message: "약속일은 오늘부터 30일 안에서 골라 주세요." };
  if (form.expectedCount !== null && (form.expectedCount < MIN_PEOPLE || form.expectedCount > MAX_PEOPLE))
    return { ok: false, message: `예상 인원은 ${MIN_PEOPLE}~${MAX_PEOPLE}명으로 정해 주세요.` };
  return {
    ok: true,
    value: {
      mode: form.mode,
      host: host.value,
      ...(form.mode === "favor" ? { favorTarget: "host" } : {}),
      ...(form.meetingDate !== "" ? { meetingDate: form.meetingDate } : {}),
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
