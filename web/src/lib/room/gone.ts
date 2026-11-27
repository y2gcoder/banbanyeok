/**
 * 방 조회·결과 조회가 "방이 없다"(404 `ROOM_NOT_FOUND`)를 받았을 때 이 기기의 방 기록을 어떻게 할지 정한다(#244, ADR-0012).
 *
 * 404는 그 요청에 실은 토큰에 대한 답이다. 참여자 토큰이 지워졌거나(내 항목을 지운 다른 탭, 지워진 참여자 토큰을 돌려받은 사다리 복구)
 * 숨긴 참가자가 남은 방이면, 방은 있어도 그 토큰으로는 404다. 그래서 바로 지우지 않고 다음 순서로 확정한다.
 *
 * 1. 기기 저장소의 지금 기록이 그 요청 때와 다르면(다른 탭이 바꿨다) 지우지 않고 지금 기록으로 다시 불러온다.
 * 2. 방장 토큰이 있고 404가 참여자 토큰에 대한 것이면 방장 토큰으로 다시 묻는다. 방이 있으면(200, 403 `ROOM_WITHHELD`) 지워진 참여자
 *    토큰만 빼고 방장 기록은 둔다. 확인하지 못하면(연결 오류) 아무것도 지우지 않는다.
 * 3. 그래도 방이 없으면, 지우기 직전에 저장소가 그대로인지 다시 보고 그때만 기록을 지운다(그사이 다른 탭이 새로 저장한 기록을 지우지 않는다).
 */
import {
  canStoreRoomTokens,
  loadRoomRecord,
  type RoomRecord,
  removeRoomRecord,
  withoutParticipant,
  writeRoomRecord,
} from "./tokens";

/** 방장 토큰으로 다시 물은 결과. `unknown`은 연결 오류처럼 판단할 수 없는 경우다. */
export type HostProbe = (hostToken: string) => Promise<"exists" | "gone" | "unknown">;

export type GoneVerdict =
  /** 방이 없다. 기록을 지웠다. */
  | { kind: "gone" }
  /** 방이 있거나 기록이 바뀌었다. 이 기록으로 다시 불러온다(null이면 기록 없이). */
  | { kind: "kept"; record: RoomRecord | null }
  /** 확인하지 못했다. 기록은 그대로다. */
  | { kind: "unknown" };

const sameCredentials = (a: RoomRecord | null, b: RoomRecord | null) =>
  a?.hostToken === b?.hostToken && a?.participantToken === b?.participantToken && a?.participantId === b?.participantId;

export async function settleRoomNotFound(
  roomId: string,
  seen: RoomRecord | null,
  probeHost: HostProbe,
): Promise<GoneVerdict> {
  // 저장소를 쓸 수 없는 브라우저는 화면이 들고 있는 기록이 유일한 기록이다.
  const stored = canStoreRoomTokens();
  const latest = () => (stored ? loadRoomRecord(roomId) : seen);
  const current = latest();
  if (!sameCredentials(current, seen)) return { kind: "kept", record: current };
  if (current?.hostToken && current.participantToken) {
    const verdict = await probeHost(current.hostToken);
    if (verdict === "unknown") return { kind: "unknown" };
    if (verdict === "exists") {
      const now = latest();
      if (!sameCredentials(now, current)) return { kind: "kept", record: now };
      const next = withoutParticipant(current);
      writeRoomRecord(roomId, next);
      return { kind: "kept", record: next };
    }
  }
  if (!sameCredentials(latest(), current)) return { kind: "kept", record: latest() };
  removeRoomRecord(roomId);
  return { kind: "gone" };
}
