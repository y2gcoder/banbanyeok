/** 입력 화면 검증(zod). 규칙은 링크 코덱(§7)과 같다: 2~4명, 별칭은 코드포인트 20자 이하. */

import type { Mode } from "@/lib/api/types";
import {
  codePointLength,
  isStationCode,
  MAX_NICKNAME_CODE_POINTS,
  MAX_PEOPLE,
  MIN_PEOPLE,
  type ShareState,
} from "@/lib/link/codec";
import { DEFAULT_SLOT, type TimeSlot } from "@/lib/when/time-slot";
import { z } from "@/lib/zod";

const stationCode = z.string().refine(isStationCode, "역 코드 형식이 아니에요");

const nicknameSchema = z
  .string()
  .refine(
    (s) => codePointLength(s) <= MAX_NICKNAME_CODE_POINTS,
    `이름은 ${MAX_NICKNAME_CODE_POINTS}자까지 쓸 수 있어요`,
  )
  .refine((s) => s.isWellFormed(), "쓸 수 없는 글자가 있어요");

const personSchema = z.object({ nickname: nicknameSchema, code: stationCode });

const inputSchema = z.object({
  people: z
    .array(personSchema)
    .min(MIN_PEOPLE, "출발역을 두 곳 이상 넣어 주세요")
    .max(MAX_PEOPLE, `최대 ${MAX_PEOPLE}명까지 넣을 수 있어요`),
});

/** 기기에 기억하는 "나" 칸(실패해도 동작에는 영향 없음). */
export const rememberedMeSchema = z.object({ code: stationCode, nickname: nicknameSchema });
export type RememberedMe = z.infer<typeof rememberedMeSchema>;

/** `favored`: "누구 쪽으로"(favor 모드)에서 배려하던 사람. 다시 입력으로 돌아와도 모드를 이어 가려고 한 줄에만 붙는다. */
export type InputRow = { nickname: string; code: string | null; favored?: boolean };

/**
 * 역을 넣은 줄만 모아 링크 상태로 만든다. 역이 2개 미만이면 오류 메시지.
 * favor 모드인데 배려하던 줄이 지워졌거나 역이 비었으면 공평으로 되돌린다.
 */
export function toShareState(
  rows: readonly InputRow[],
  timeSlot: TimeSlot = DEFAULT_SLOT,
  mode: Mode = "fair",
): { ok: true; state: ShareState } | { ok: false; message: string } {
  const filled = rows.flatMap((row) =>
    row.code ? [{ nickname: row.nickname.trim(), code: row.code, favored: row.favored === true }] : [],
  );
  const parsed = inputSchema.safeParse({ people: filled });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "입력을 확인해 주세요" };
  const people = parsed.data.people;
  const favorIndex = mode === "favor" ? filled.findIndex((p) => p.favored) : -1;
  const nicknames = people.map((p) => p.nickname || null);
  return {
    ok: true,
    state: {
      origins: people.map((p) => p.code),
      mode: favorIndex >= 0 ? "favor" : mode === "favor" ? "fair" : mode,
      favorIndex: favorIndex >= 0 ? favorIndex : null,
      nicknames: nicknames.some((n) => n) ? nicknames : null,
      timeSlot,
    },
  };
}
