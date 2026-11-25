import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { type APIRequestContext, expect } from "@playwright/test";

/**
 * 새로 출발역을 숨길 수 없으므로(ADR-0007, 서버는 400 `HIDE_NOT_AVAILABLE`), 그 전에 숨긴 채 들어온 참가자(아직 남은 옛 방)는 로컬·CI의
 * 개발 DB(`scripts/dev.sh db`, docker compose의 db) 행을 직접 바꿔 만든다. 서버 통합 테스트(`ApiIntegrationTest.hideAsBefore`)와 같은
 * 방법이다. 숨김 코드를 걷어내는 2단계(#182)에서 지운다.
 */
const repoRoot = resolve(import.meta.dirname, "../..");
const ID = /^[0-9a-hjkmnp-tv-z]+$/;

export function hideAsBefore(roomId: string, participantId: string) {
  if (!ID.test(roomId) || !ID.test(participantId)) throw new Error(`방·참가자 ID가 아니다: ${roomId} ${participantId}`);
  const sql = `UPDATE participants SET hidden = true WHERE room_id = '${roomId}' AND pid = '${participantId}' RETURNING pid`;
  const out = execFileSync(
    "bash",
    [
      "scripts/dev.sh",
      "db",
      "exec",
      "-T",
      "db",
      "psql",
      "-U",
      "local",
      "-d",
      "banbanyeok",
      "-v",
      "ON_ERROR_STOP=1",
      "-qtAc",
      sql,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  expect(out.trim(), "숨길 참가자 행이 하나 있어야 한다").toBe(participantId);
}

/** API로 참여시킨 뒤(새 숨김은 거절됨을 확인) 옛 방처럼 숨긴 참가자로 만든다. 참가자 ID를 돌려준다. */
export async function joinHiddenAsBefore(
  request: APIRequestContext,
  roomId: string,
  body: { originCode: string; nickname?: string },
): Promise<string> {
  const refused = await request.post(`/api/v1/rooms/${roomId}/participants`, { data: { ...body, hidden: true } });
  expect(refused.status()).toBe(400);
  expect(((await refused.json()) as { code: string }).code).toBe("HIDE_NOT_AVAILABLE");
  const joined = await request.post(`/api/v1/rooms/${roomId}/participants`, { data: body });
  expect(joined.status()).toBe(201);
  const { participantId } = (await joined.json()) as { participantId: string };
  hideAsBefore(roomId, participantId);
  return participantId;
}
