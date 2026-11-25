/**
 * 방의 '누구 쪽으로' 뽑기 상태(#172)를 화면 값으로. 운과 대상은 서버가 정한다(`Room.favorDraw`): 이 모듈은 그것을 읽기만 한다.
 * 출발역을 숨긴 사람이 빠지는 규칙도 서버(`FavorDrawRule.isCandidate`)에 있고, 웹에서는 여기 한 곳에서 그 결과(`excluded`)를 읽는다
 * (숨기기를 다시 보는 #173에서 걷어낼 때 이 함수만 보면 된다).
 */
import type { Room } from "@/lib/api/types";

/** 뽑기 대상 한 사람. `personIndex`는 방의 참가자 순서(사람 색이 이것을 따른다). */
export type DrawPerson = { id: string; name: string; personIndex: number };

export type RoomDraw = {
  /** 이 뽑기를 가리키는 값(세대와 회차). 기기에 "그림을 본 뽑기"로 저장하고, 바뀌면 카드를 새로 그린다. */
  key: string;
  /** 뽑기 세대(뽑기 전으로 돌아갈 때마다 1씩 커진다). 뽑기 요청에 그대로 보낸다. */
  generation: number;
  /** 0 = 아직, 2 = 다시 뽑음. */
  round: number;
  maxRounds: number;
  /** 그림의 칸 순서(입장 순서). */
  candidates: DrawPerson[];
  /** candidates 안의 당첨자 위치. 아직이면 null. */
  winner: number | null;
  winnerId: string | null;
  /** 출발역을 숨겨서 빠진 사람. */
  hiddenNames: string[];
  /** 뽑은 뒤에 들어온 사람. */
  lateNames: string[];
  /** 이 화면을 보는 사람이 뽑은 뒤에 들어왔다. */
  selfLate: boolean;
  drawnAt: string | null;
};

const nameOf = (p: Room["participants"][number]) => (p.shortLabel as string | undefined) ?? p.label;

/** 뽑기로 만든 방이 아니거나 뽑기를 모르는 옛 서버면 null. */
export function roomDraw(room: Room): RoomDraw | null {
  const draw = room.favorDraw;
  if (!draw) return null;
  const indexOf = new Map(room.participants.map((p, index) => [p.participantId, index] as const));
  const candidates = draw.candidates.flatMap((id) => {
    const index = indexOf.get(id);
    const p = index === undefined ? undefined : room.participants[index];
    return p && index !== undefined ? [{ id, name: nameOf(p), personIndex: index }] : [];
  });
  const excludedAs = (reason: "hidden" | "late") =>
    draw.excluded.flatMap((e) => {
      const p = e.reason === reason ? room.participants.find((q) => q.participantId === e.participantId) : undefined;
      return p ? [p] : [];
    });
  const late = excludedAs("late");
  const winner = draw.winner ? candidates.findIndex((c) => c.id === draw.winner) : -1;
  return {
    key: `${draw.generation}:${draw.round}`,
    generation: draw.generation,
    round: draw.round,
    maxRounds: draw.maxRounds,
    candidates,
    winner: winner >= 0 ? winner : null,
    winnerId: winner >= 0 ? (draw.winner ?? null) : null,
    hiddenNames: excludedAs("hidden").map(nameOf),
    lateNames: late.map(nameOf),
    selfLate: late.some((p) => p.isSelf === true),
    drawnAt: draw.drawnAt ?? null,
  };
}
