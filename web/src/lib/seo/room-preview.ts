/**
 * 방 링크(`/r/<id>?sv=<n>`)의 미리보기를 서버(Workers)에서 받는다. 메타데이터와 그림 경로가 같이 쓴다.
 * 크롤러(카카오·슬랙 등)는 오래 기다려 주지 않으므로 3초 안에 못 받거나 실패하면 null이고, 부른 쪽은 기본 초대 미리보기로 간다.
 */
import type { Metadata } from "next";
import { cache } from "react";
import { getRoomPreview } from "@/lib/api/rooms";
import type { RoomPreview } from "@/lib/api/types";
import { roomShareCopy } from "@/lib/room/share-copy";
import { roomImagePath } from "@/lib/room/share-link";
import { roomLinkMetadata, roomPreviewMetadata } from "./metadata";

const PREVIEW_TIMEOUT_MS = 3000;

/** `signal`은 부른 쪽의 중단 신호(그림 경로의 시간 예산). 신호 없이 부르는 곳(메타데이터)끼리만 한 요청에서 한 번으로 묶인다. */
async function fetchPreview(roomId: string, signal: AbortSignal | undefined): Promise<RoomPreview | null> {
  try {
    const timeout = AbortSignal.timeout(PREVIEW_TIMEOUT_MS);
    return await getRoomPreview(roomId, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  } catch {
    return null;
  }
}

export const loadRoomPreview = cache(fetchPreview);

/**
 * `sv`가 지금 번호 이하면 지금 상태를 그린다. 번호는 되돌아가지 않으므로 예전 번호의 링크가 나중에 처음 읽혀도 그 링크에는 옛 내용이
 * 캐시된 적이 없다. 지금보다 큰 번호(손으로 고친 주소)나 서버 실패는 기본 초대 문구다. 그림 주소는 요청한 번호가 아니라 지금 번호를 싣는다.
 */
export async function roomShareMetadata(roomId: string, sv: number): Promise<Metadata> {
  const preview = await loadRoomPreview(roomId, undefined);
  if (!preview || sv > preview.room.shareVersion) return roomLinkMetadata();
  const copy = roomShareCopy(preview);
  const image =
    copy.card && preview.stage !== "collecting"
      ? roomImagePath(roomId, preview.room.shareVersion, preview.dataVersion)
      : null;
  return roomPreviewMetadata(copy, image);
}
