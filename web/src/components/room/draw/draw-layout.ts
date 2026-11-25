/**
 * 뽑기 화면의 그림 배치. 운(당첨자)은 서버가 정해 방에 저장하고, 화면은 그 결과를 재생만 한다.
 * 그림(사다리 가로줄)은 방 ID와 그 뽑기(회차·뽑은 시각)로 만든 씨앗에서 나오므로 누가 열어도 같은 그림이다.
 * 당첨 자리는 그림을 만든 뒤 당첨자의 길이 닿는 칸에 둔다(그림이 운을 정하지 않는다).
 */

/** 문자열 → 32비트 씨앗(FNV-1a). 보안용이 아니라 그림을 모두에게 같게 만드는 용도다. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** mulberry32: 씨앗이 같으면 같은 수열. */
function randomFrom(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Ladder = {
  columns: number;
  rows: number;
  /** rungs[row]에 든 c는 c번 줄과 c+1번 줄을 잇는 가로줄. 같은 행에서 붙어 있는 가로줄은 없다. */
  rungs: number[][];
  /** 위 c번 줄에서 출발하면 아래 몇 번 칸에 닿는지. */
  ends: number[];
};

const LADDER_ROWS = 8;
const LADDER_TRIES = 64;

/** 위에서 내려가며 가로줄을 따라 바꾼 도착 칸. */
function endsOf(columns: number, rungs: readonly number[][]): number[] {
  return Array.from({ length: columns }, (_, start) => {
    let col = start;
    for (const line of rungs) {
      if (line.includes(col)) col += 1;
      else if (line.includes(col - 1)) col -= 1;
    }
    return col;
  });
}

/**
 * 한 행의 가로줄. 지금까지 가로줄이 적은 이웃 쌍부터 넣어(같은 행에서 붙은 쌍은 건너뛴다) 모든 쌍에 고르게 퍼지게 한다.
 * 순서가 같은 쌍은 씨앗으로 섞는다.
 */
function rowOf(columns: number, counts: number[], random: () => number): number[] {
  const order = Array.from({ length: columns - 1 }, (_, c) => ({ c, key: (counts[c] ?? 0) + random() * 1.5 }))
    .sort((a, b) => a.key - b.key)
    .map((item) => item.c);
  const line: number[] = [];
  for (const c of order) {
    if (line.includes(c - 1) || line.includes(c + 1)) continue;
    // 가장 적은 쌍은 꼭 넣고, 나머지는 반쯤만 넣어 행마다 모양이 다르게. 두 줄짜리는 모든 행에 넣으면 가로줄 수가 늘 짝수라
    // 제자리로 돌아오므로 반쯤만 넣는다.
    if ((line.length === 0 && columns > 2) || random() < 0.55) line.push(c);
  }
  return line.sort((a, b) => a - b);
}

/**
 * 씨앗으로 사다리를 만든다. 진짜 사다리처럼 보이게 다음을 만족할 때까지 같은 수열에서 다시 만든다(그래서 씨앗이 같으면 결과도 같다):
 * 모든 이웃 쌍에 가로줄이 2개 이상이고 쌍 사이 개수 차이가 2 이하, 누구도 출발한 칸 바로 아래에 도착하지 않는다.
 */
export function ladderOf(columns: number, seed: number): Ladder {
  const random = randomFrom(seed);
  let best: number[][] = [];
  for (let attempt = 0; attempt < LADDER_TRIES; attempt++) {
    const counts = Array.from({ length: Math.max(0, columns - 1) }, () => 0);
    const rungs: number[][] = [];
    for (let row = 0; row < LADDER_ROWS; row++) {
      const line = columns > 1 ? rowOf(columns, counts, random) : [];
      for (const c of line) counts[c] = (counts[c] ?? 0) + 1;
      rungs.push(line);
    }
    best = rungs;
    const ends = endsOf(columns, rungs);
    const even = counts.length === 0 || (Math.min(...counts) >= 2 && Math.max(...counts) - Math.min(...counts) <= 2);
    const moved = columns < 2 || ends.every((end, start) => end !== start);
    if (even && moved) break;
  }
  return { columns, rows: LADDER_ROWS, rungs: best, ends: endsOf(columns, best) };
}

/** 사다리 좌표계에서 start번 줄의 길(꺾이는 점들). x는 줄 번호, y는 0(위)~rows+1(아래). */
export function ladderPath(ladder: Ladder, start: number): { x: number; y: number }[] {
  const points = [{ x: start, y: 0 }];
  let col = start;
  ladder.rungs.forEach((line, row) => {
    const y = row + 1;
    if (line.includes(col)) {
      points.push({ x: col, y }, { x: col + 1, y });
      col += 1;
    } else if (line.includes(col - 1)) {
      points.push({ x: col, y }, { x: col - 1, y });
      col -= 1;
    }
  });
  points.push({ x: col, y: ladder.rows + 1 });
  return points;
}
