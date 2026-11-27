import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect } from "@playwright/test";

/**
 * 출발역을 숨길 수 없으므로(ADR-0007, 서버는 400 `HIDE_NOT_AVAILABLE`), 그 전에 숨긴 채 들어온 참가자(예상 밖으로 남았거나 백업에서
 * 되살아난 행)는 로컬·CI의 개발 DB(`scripts/dev.sh db`, docker compose의 db) 행을 직접 바꿔 만든다. 서버 통합 테스트
 * (`ApiIntegrationTest.hideAsBefore`)와 같은 방법이다. `participants.hidden` 열을 지우는 단계(#182, ADR-0012)에서 함께 지운다.
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
