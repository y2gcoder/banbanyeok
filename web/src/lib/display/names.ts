/** 별칭이 없으면(null·공백) 입력 순서대로 "나/친구1/친구2/친구3"(shared/app-logic `DisplayNames`와 같음). */
export const DEFAULT_NAMES = ["나", "친구1", "친구2", "친구3"] as const;

export function displayNames(nicknames: readonly (string | null | undefined)[] | null, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const name = nicknames?.[i];
    return name?.trim() ? name : (DEFAULT_NAMES[i] ?? `친구${i}`);
  });
}
