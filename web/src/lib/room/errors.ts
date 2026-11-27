/** 방 API 오류를 화면 문구·상태로 바꾼다. 분기는 항상 `code`로 한다(계약 Error 표). */
import { ApiRequestError } from "@/lib/api/client";
import {
  CONNECTION_MESSAGE,
  regionMismatchMessage,
  resultErrorMessage,
  SCHEDULE_UNAVAILABLE_MESSAGE,
} from "@/lib/api/errors";

const MESSAGES: Readonly<Record<string, string>> = {
  ROOM_NOT_FOUND: "없거나 만료된 방이에요.",
  ROOM_WITHHELD: "지금은 열 수 없는 방이에요. 이 기기에서는 지우기만 할 수 있어요.",
  ROOM_FULL: "방이 가득 찼어요. 한 방에는 최대 4명까지 들어올 수 있어요.",
  ROOM_LOCKED: "이 방은 지금 새로 들어올 수 없어요. 방장이 잠갔거나 정해 둔 인원이 다 찼어요.",
  INVALID_STATION: "계산할 수 없는 역이에요. 다른 역을 골라 주세요.",
  INVALID_NICKNAME: "이름을 확인해 주세요. 20자 이하로 쓸 수 있어요.",
  INVALID_MEETING_DATE: "약속일이 이미 지났어요. 오늘 이후 날짜를 골라 주세요.",
  INVALID_EXPECTED_COUNT: "예상 인원은 2~4명으로 정해 주세요.",
  INVALID_OTHERS: "사다리 방에 넣을 사람을 다시 확인해 주세요.",
  INVALID_OUTCOME: "답을 보내지 못했어요. 역을 다시 골라 주세요.",
  PARTICIPANT_NOT_FOUND: "이 방에서 빠진 항목이에요. 다시 참여해 주세요.",
  UNAUTHORIZED: "이 기기에서는 고칠 수 없어요. 처음 참여한 기기에서만 고칠 수 있어요.",
  FORBIDDEN: "이 기기에서는 할 수 없는 일이에요.",
  RATE_LIMITED: "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.",
  STATION_UNAVAILABLE: "방을 만든 뒤 데이터가 바뀌어 계산할 수 없는 출발역이 있어요. 출발역을 다시 골라 주세요.",
  NOT_ENOUGH_PARTICIPANTS: "두 명 이상 들어와야 결과를 볼 수 있어요.",
  ROOM_CHANGED: "그사이 방이 바뀌었어요. 새로 불러왔으니 다시 골라 주세요.",
  FAVOR_TARGET_HIDDEN: "출발역을 숨긴 사람 쪽으로 맞춘 결과는 그 사람만 볼 수 있어요. 다른 기준을 골라 주세요.",
  DRAW_NOT_AVAILABLE: "이 방은 뽑기로 정하는 방이 아니에요.",
  NOT_ENOUGH_DRAW_CANDIDATES: "뽑기에 들어갈 사람이 두 명 이상이어야 뽑을 수 있어요.",
  HIDE_NOT_AVAILABLE: "출발역 숨기기는 이제 쓸 수 없어요. 숨기기를 끄고 다시 해 주세요.",
  DRAW_LIMIT_REACHED: "다시 뽑기는 한 번만 할 수 있어요.",
  SCHEDULE_UNAVAILABLE: SCHEDULE_UNAVAILABLE_MESSAGE,
};

/**
 * 사용자에게 보여 줄 문구. 알려진 code는 우리 문구, 계약의 오류 모양을 가진 그 밖의 4xx는 서버 message, 나머지는 결과 화면과 같은 안내.
 * `regionNames`는 권역이 섞였을 때 짚을 권역 이름이다(lib/room/region.ts의 roomRegionNames).
 */
export function roomErrorMessage(error: unknown, regionNames: readonly string[] = []): string {
  if (!(error instanceof ApiRequestError)) return CONNECTION_MESSAGE;
  if (error.code === "REGION_MISMATCH") return regionMismatchMessage(regionNames);
  const known = MESSAGES[error.code];
  if (known) return known;
  const fromServer = error.code !== "UNKNOWN" && error.status >= 400 && error.status < 500 && error.message;
  return fromServer || resultErrorMessage(error);
}

/**
 * 참여·고치기의 오류 문구. 서버는 방의 요일·시간대에 시간표를 확인하지 못한 출발역을 저장하지 않는다(409 `SCHEDULE_UNAVAILABLE`).
 * 웹 인덱스가 서버 데이터보다 낡아 칸이 미리 막지 못한 경우다. 참여자는 방의 요일을 바꿀 수 없으니 역을 바꾸라고만 한다.
 */
export function participantErrorMessage(error: unknown, regionNames: readonly string[] = []): string {
  if (error instanceof ApiRequestError && error.code === "SCHEDULE_UNAVAILABLE") return PARTICIPANT_SCHEDULE_MESSAGE;
  return roomErrorMessage(error, regionNames);
}

const PARTICIPANT_SCHEDULE_MESSAGE =
  "이 방의 요일·시간대에는 고른 역의 시간표를 아직 확인하지 못해 고를 수 없어요. 다른 출발역을 골라 주세요.";

export const errorCode = (error: unknown): string | null => (error instanceof ApiRequestError ? error.code : null);

/** 화면이 그린 방이 오래됐다는 답(정원·잠김·없어짐, 그사이 바뀐 방). 다시 불러와 안내를 바꾼다. */
const STALE_ROOM_CODES: ReadonlySet<string> = new Set(["ROOM_FULL", "ROOM_LOCKED", "ROOM_NOT_FOUND", "ROOM_CHANGED"]);
export const isStaleRoom = (error: unknown): boolean =>
  error instanceof ApiRequestError && STALE_ROOM_CODES.has(error.code);

/** 방이 없다(만료·삭제·없는 ID 모두 같은 404). */
export const isRoomGone = (error: unknown): boolean =>
  error instanceof ApiRequestError && error.code === "ROOM_NOT_FOUND";

/**
 * 숨긴 참가자가 남은 옛 방에 이 방의 토큰으로 왔다(ADR-0012). 방은 있으므로 기기 기록을 지우지 않는다: 서버를 이전 판으로 되돌리면
 * 같은 기록으로 다시 열고 고칠 수 있어야 한다. 지금 할 수 있는 것은 지우기(방장의 방 삭제, 내 항목 삭제)뿐이다.
 */
export const isRoomWithheld = (error: unknown): boolean =>
  error instanceof ApiRequestError && error.code === "ROOM_WITHHELD";

/** 토큰이 더는 통하지 않는다(내보내졌거나 항목이 지워짐). 다시 참여하게 안내한다. */
export const isTokenRejected = (error: unknown): boolean =>
  error instanceof ApiRequestError &&
  (error.code === "UNAUTHORIZED" || error.code === "PARTICIPANT_NOT_FOUND" || error.code === "FORBIDDEN");

/** 다시 시도해도 같은 결과일 오류인지(4xx). 5xx·네트워크 오류만 자동 재시도한다. */
export const isClientError = (error: unknown): boolean =>
  error instanceof ApiRequestError && error.status >= 400 && error.status < 500;

/** 채운 사다리 방 만들기 경로(`POST /draw-rooms`, #227)를 모르는 옛 서버의 답. 아무것도 저장하지 않고 404나 405로 거절한다. */
export const isDrawRoomUnsupported = (error: unknown): boolean =>
  error instanceof ApiRequestError && (error.status === 404 || error.status === 405);
