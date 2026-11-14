import { type RememberedMe, rememberedMeSchema } from "./input";

const KEY = "banbanyeok:me";

/** localStorage는 막혀 있을 수 있다(사파리 개인 모드 등). 실패하면 조용히 무시한다. */
export function loadRememberedMe(): RememberedMe | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = rememberedMeSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveRememberedMe(me: RememberedMe): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(me));
  } catch {
    // 기억하지 못해도 입력은 동작한다.
  }
}
