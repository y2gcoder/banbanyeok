/**
 * 방의 '누구 쪽으로' 뽑기 상태(#172)를 화면 값으로. 운과 대상은 서버가 정한다(`Room.favorDraw`): 이 모듈은 그것을 읽기만 한다.
 * 출발역을 숨긴 사람이 빠지는 규칙도 서버(`FavorDrawRule.isCandidate`)에 있고, 웹에서는 여기 한 곳에서 그 결과(`excluded`)를 읽는다
 * (숨기기를 다시 보는 #173에서 걷어낼 때 이 함수만 보면 된다).
 */
import type { Room } from "@/lib/api/types";

/**
 * 그림의 한 칸. 서버는 뽑을 때의 대상을 그대로 주므로(같은 세대·회차면 언제 봐도 같은 그림) 그 뒤에 나간 사람도 칸이 남는다.
 * 그 사람은 이름을 모르니 `left`이고 `personIndex`가 null이다(사람 색 대신 흐린 선).
 */
export type DrawPerson = { id: string; name: string; personIndex: number | null; left: boolean };

/** 뽑은 뒤 들어온 사람. 출발역을 숨겼으면 다시 뽑아도 빠진다. */
type LatePerson = { name: string; hidden: boolean };

export type RoomDraw = {
  /** 이 뽑기를 가리키는 값(세대와 회차). 바뀌면 카드를 새로 그린다. */
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
  /** 출발역을 숨겨서 빠진 사람(뽑기 전이면 지금, 뽑은 뒤면 뽑을 때의 상태). */
  hiddenNames: string[];
  /** 뽑은 뒤에 들어온 사람. */
  late: LatePerson[];
  /** 이 화면을 보는 사람이 뽑은 뒤에 들어왔다. */
  selfLate: boolean;
  drawnAt: string | null;
};

/** 나간 사람의 칸 이름. 서버가 이름을 주지 않는다(방에 없는 사람). */
const LEFT_NAME = "나간 사람";

const nameOf = (p: Room["participants"][number]) => (p.shortLabel as string | undefined) ?? p.label;

/** 뽑기로 만든 방이 아니거나 뽑기를 모르는 옛 서버면 null. */
export function roomDraw(room: Room): RoomDraw | null {
  const draw = room.favorDraw;
  if (!draw) return null;
  const candidates = draw.candidates.map((id): DrawPerson => {
    const index = room.participants.findIndex((p) => p.participantId === id);
    const p = room.participants[index];
    return p
      ? { id, name: nameOf(p), personIndex: index, left: false }
      : { id, name: LEFT_NAME, personIndex: null, left: true };
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
    late: late.map((p) => ({ name: nameOf(p), hidden: p.hidden })),
    selfLate: late.some((p) => p.isSelf === true),
    drawnAt: draw.drawnAt ?? null,
  };
}
