import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import { CONNECTION_MESSAGE } from "@/lib/api/errors";
import { errorCode, isClientError, isRoomGone, isTokenRejected, roomErrorMessage } from "./errors";

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
});
