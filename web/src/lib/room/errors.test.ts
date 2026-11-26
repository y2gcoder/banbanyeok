import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import { CONNECTION_MESSAGE } from "@/lib/api/errors";
import {
  errorCode,
  isClientError,
  isRoomGone,
  isStaleRoom,
  isTokenRejected,
  participantErrorMessage,
  roomErrorMessage,
} from "./errors";

const err = (status: number, code: string, message = "서버 문구") => new ApiRequestError(status, code, message);

describe("방 오류", () => {
  it("알려진 code는 우리 문구, 그 밖의 4xx는 서버 message, 5xx·네트워크는 연결 안내", () => {
    expect(roomErrorMessage(err(409, "ROOM_FULL"))).toContain("가득");
    expect(roomErrorMessage(err(409, "ROOM_LOCKED"))).toContain("잠갔");
    expect(roomErrorMessage(err(404, "ROOM_NOT_FOUND"))).toContain("만료");
    expect(roomErrorMessage(err(400, "SOMETHING_NEW", "새 오류예요"))).toBe("새 오류예요");
    expect(roomErrorMessage(err(502, "UPSTREAM_UNAVAILABLE"))).toBe(CONNECTION_MESSAGE);
    expect(roomErrorMessage(new TypeError("Failed to fetch"))).toBe(CONNECTION_MESSAGE);
  });

  it("새로 숨기기를 거절한 답(HIDE_NOT_AVAILABLE, ADR-0007)은 숨기기를 끄고 다시 하라고 안내한다", () => {
    expect(roomErrorMessage(err(400, "HIDE_NOT_AVAILABLE"))).toBe(
      "출발역 숨기기는 이제 쓸 수 없어요. 숨기기를 끄고 다시 해 주세요.",
    );
    expect(isStaleRoom(err(400, "HIDE_NOT_AVAILABLE"))).toBe(false);
  });

  it("참여·고치기에서 서버가 방의 요일에 출발할 수 없는 역을 거절하면 요일이 아니라 역을 바꾸라고 한다", () => {
    expect(participantErrorMessage(err(409, "SCHEDULE_UNAVAILABLE"))).toBe(
      "이 방의 요일·시간대에는 고른 역의 시간표를 아직 확인하지 못해 고를 수 없어요. 다른 출발역을 골라 주세요.",
    );
    expect(roomErrorMessage(err(409, "SCHEDULE_UNAVAILABLE"))).toContain("다른 요일이나 시간대로");
    expect(participantErrorMessage(err(409, "ROOM_FULL"))).toBe(roomErrorMessage(err(409, "ROOM_FULL")));
    expect(isStaleRoom(err(409, "SCHEDULE_UNAVAILABLE"))).toBe(false);
  });

  it("계약의 오류 모양이 아닌 4xx(빈 본문·HTML)는 'HTTP 403' 같은 값을 보이지 않는다", () => {
    expect(roomErrorMessage(err(403, "UNKNOWN", "HTTP 403"))).not.toMatch(/HTTP|403/);
  });

  it("분기용 판별", () => {
    expect(isRoomGone(err(404, "ROOM_NOT_FOUND"))).toBe(true);
    expect(isRoomGone(err(404, "PARTICIPANT_NOT_FOUND"))).toBe(false);
    expect(isTokenRejected(err(401, "UNAUTHORIZED"))).toBe(true);
    expect(isTokenRejected(err(404, "PARTICIPANT_NOT_FOUND"))).toBe(true);
    expect(isTokenRejected(err(409, "ROOM_FULL"))).toBe(false);
    expect(isClientError(err(409, "ROOM_FULL"))).toBe(true);
    expect(isClientError(err(503, "UPSTREAM_NOT_CONFIGURED"))).toBe(false);
    expect(isClientError(new TypeError("x"))).toBe(false);
    expect(errorCode(err(409, "ROOM_FULL"))).toBe("ROOM_FULL");
    expect(errorCode(new Error("x"))).toBeNull();
  });

  it("오래된 화면이라 다시 불러와야 하는 답: 정원·잠김·없어짐·그사이 바뀐 방", () => {
    for (const code of ["ROOM_FULL", "ROOM_LOCKED", "ROOM_NOT_FOUND", "ROOM_CHANGED"]) {
      expect(isStaleRoom(err(409, code)), code).toBe(true);
    }
    expect(isStaleRoom(err(400, "INVALID_STATION"))).toBe(false);
    expect(isStaleRoom(new TypeError("x"))).toBe(false);
    expect(roomErrorMessage(err(409, "ROOM_CHANGED"))).toBe(
      "그사이 방이 바뀌었어요. 새로 불러왔으니 다시 골라 주세요.",
    );
  });
});
