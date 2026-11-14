/**
 * 화면의 분 값 규칙. shared/app-logic `DisplayMinutes`(docs/setup/p6-notes.md 4.1)와 같아야 한다.
 *
 * - 초 → 분은 30초를 올림: `분 = floor((초 + 30) / 60)`.
 * - 합계·차이·최장 같은 파생 값은 **반올림한 사람별 분에서 다시 계산한다**(화면 숫자끼리 더하고 빼면 맞는다).
 * - 순위는 서버가 반올림 전 초로 정한다. 웹은 표시만 반올림한다.
 */
export function minutesFromSeconds(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 0) throw new RangeError(`초는 0 이상의 정수여야 합니다: ${seconds}`);
  return Math.floor((seconds + 30) / 60);
}

/** "38분", "1시간", "1시간 4분". */
export function formatMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError(`분은 0 이상의 정수여야 합니다: ${minutes}`);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}분`;
  return rest === 0 ? `${hours}시간` : `${hours}시간 ${rest}분`;
}

export function formatSeconds(seconds: number): string {
  return formatMinutes(minutesFromSeconds(seconds));
}

/** 0 → "환승 없음", n → "환승 n번". */
export function transferLabel(transfers: number): string {
  if (!Number.isInteger(transfers) || transfers < 0)
    throw new RangeError(`환승은 0 이상의 정수여야 합니다: ${transfers}`);
  return transfers === 0 ? "환승 없음" : `환승 ${transfers}번`;
}

export type DisplayAggregate = {
  /** 사람별 표시 분(입력 순서). */
  minutes: number[];
  max: number;
  min: number;
  spread: number;
  total: number;
};

/** 사람별 초에서 화면 숫자 묶음을 만든다. 파생 값은 반올림한 분에서 계산한다. */
export function displayAggregate(seconds: readonly number[]): DisplayAggregate {
  if (seconds.length === 0) throw new RangeError("사람이 없습니다");
  const minutes = seconds.map(minutesFromSeconds);
  const max = Math.max(...minutes);
  const min = Math.min(...minutes);
  return { minutes, max, min, spread: max - min, total: minutes.reduce((a, b) => a + b, 0) };
}
