import { describe, expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import { errorPolicy, type RoomAction } from "./action-policy";

const err = (status: number, code: string) => new ApiRequestError(status, code, "서버 문구");

/** 오류 → 동작별로 "다시 불러오기(R)"·"알림 칸에 올리기(M)"를 손으로 적은 표. 행: 오류, 열: 동작. */
const ACTIONS: readonly RoomAction[] = ["join", "edit", "leave", "kick", "lock", "remove", "decide"];
const TABLE: readonly { name: string; error: unknown; refresh: readonly RoomAction[] }[] = [
  { name: "404 ROOM_NOT_FOUND", error: err(404, "ROOM_NOT_FOUND"), refresh: ACTIONS },
  { name: "409 ROOM_FULL", error: err(409, "ROOM_FULL"), refresh: ["join", "decide"] },
  { name: "409 ROOM_LOCKED", error: err(409, "ROOM_LOCKED"), refresh: ["join", "decide"] },
  { name: "409 ROOM_CHANGED", error: err(409, "ROOM_CHANGED"), refresh: ["join", "decide"] },
  { name: "401 UNAUTHORIZED", error: err(401, "UNAUTHORIZED"), refresh: ["edit", "decide"] },
  { name: "404 PARTICIPANT_NOT_FOUND", error: err(404, "PARTICIPANT_NOT_FOUND"), refresh: ["edit", "decide"] },
  { name: "403 FORBIDDEN", error: err(403, "FORBIDDEN"), refresh: ["edit", "decide"] },
  { name: "400 INVALID_STATION", error: err(400, "INVALID_STATION"), refresh: [] },
  { name: "429 RATE_LIMITED", error: err(429, "RATE_LIMITED"), refresh: [] },
  { name: "503 UPSTREAM_UNAVAILABLE", error: err(503, "UPSTREAM_UNAVAILABLE"), refresh: [] },
  { name: "네트워크 오류", error: new TypeError("Failed to fetch"), refresh: [] },
];
const REPORT: readonly RoomAction[] = ["leave", "kick", "lock", "remove", "decide"];

describe("방 쓰기 동작의 오류 정책", () => {
  for (const row of TABLE) {
    describe(row.name, () => {
      it.each(ACTIONS)("%s", (action) => {
        expect(errorPolicy(action, row.error)).toEqual({
          refresh: row.refresh.includes(action),
          report: REPORT.includes(action),
        });
      });
    });
  }

  it("참여·수정은 오류 문구를 알림 칸에 올리지 않는다(폼이 자기 오류를 보여 준다)", () => {
    expect(errorPolicy("join", err(409, "ROOM_FULL")).report).toBe(false);
    expect(errorPolicy("edit", err(401, "UNAUTHORIZED")).report).toBe(false);
  });
});
