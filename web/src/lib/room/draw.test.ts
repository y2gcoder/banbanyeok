import { describe, expect, it } from "vitest";
import type { Room } from "@/lib/api/types";
import { roomDraw } from "./draw";

const person = (id: string, patch: Partial<Room["participants"][number]> = {}): Room["participants"][number] => ({
  participantId: id,
  hidden: false,
  originCode: "ryf",
  originName: "홍대입구",
  label: id,
  labelKind: "name",
  shortLabel: id,
  isHost: false,
  isSelf: false,
  ...patch,
});

const room = (
  favorDraw: NonNullable<Room["favorDraw"]> | null,
  participants = [person("민수"), person("지영"), person("하늘")],
): Room => ({
  roomId: "qt7yvmsht3",
  mode: "favor",
  favorTarget: favorDraw?.winner ?? null,
  locked: false,
  expiresAt: "2999-01-01T00:00:00Z",
  dataVersion: "1",
  participants,
  favorDraw,
});

describe("roomDraw(#172): 서버가 정한 대상·당첨·빠진 사람을 그대로 읽는다", () => {
  it("뽑기 방이 아니거나 옛 서버면 null", () => {
    expect(roomDraw(room(null))).toBeNull();
    const { favorDraw: _old, ...oldServer } = room(null);
    expect(roomDraw(oldServer)).toBeNull();
  });

  it("뽑기 전: 대상은 입장 순서고 당첨자는 없다", () => {
    const draw = roomDraw(
      room(
        {
          generation: 0,
          round: 0,
          maxRounds: 2,
          candidates: ["민수", "지영"],
          winner: null,
          drawnAt: null,
          excluded: [],
        },
        [person("민수"), person("지영"), person("하늘")],
      ),
    );
    expect(draw?.candidates.map((c) => [c.name, c.personIndex])).toEqual([
      ["민수", 0],
      ["지영", 1],
    ]);
    expect(draw?.winner).toBeNull();
    expect(draw?.key).toBe("0:0");
  });

  it("뽑은 뒤: 당첨자 위치, 뒤늦게 들어온 사람(본인이면 표시), 그림의 색(사람 순서)은 방의 참가자 순서를 따른다", () => {
    const draw = roomDraw(
      room(
        {
          generation: 3,
          round: 2,
          maxRounds: 2,
          candidates: ["민수", "하늘"],
          winner: "하늘",
          drawnAt: "2026-11-25T11:14:00Z",
          excluded: [{ participantId: "지영", reason: "late" }],
        },
        [person("민수"), person("지영", { isSelf: true }), person("하늘")],
      ),
    );
    expect(draw?.winner).toBe(1);
    expect(draw?.winnerId).toBe("하늘");
    expect(draw?.candidates[1]?.personIndex).toBe(2);
    expect(draw?.late).toEqual(["지영"]);
    expect(draw?.selfLate).toBe(true);
    expect(draw?.key).toBe("3:2");
    expect(draw?.generation).toBe(3);
  });

  it("뽑은 뒤 나간 대상도 칸이 남는다(이름 없이 '나간 사람', 사람 색 없음): 같은 세대·회차면 같은 그림", () => {
    const draw = roomDraw(
      room(
        {
          generation: 0,
          round: 1,
          maxRounds: 2,
          candidates: ["민수", "떠남", "하늘"],
          winner: "하늘",
          drawnAt: "2026-11-25T11:14:00Z",
          excluded: [],
        },
        [person("민수"), person("하늘")],
      ),
    );
    expect(draw?.candidates.map((c) => [c.name, c.personIndex, c.left])).toEqual([
      ["민수", 0, false],
      ["나간 사람", null, true],
      ["하늘", 1, false],
    ]);
    expect(draw?.winner).toBe(2);
  });
});
