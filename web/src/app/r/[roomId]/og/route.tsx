import { ogImageResponse } from "@/components/og/og-response";
import { SharedCard } from "@/components/og/shared-card";
import { getRoom } from "@/lib/api/rooms";
import { mayIncludeHidden } from "@/lib/result/banban-index";
import { isRoomId, normalizeRoomId } from "@/lib/room/id";
import { ROOM_PREVIEW_LAST_TRAIN, roomShareCopy } from "@/lib/room/share-copy";
import { parseDataVersion, parseShareVersion, SHARE_VERSION_PARAM } from "@/lib/room/share-link";
import { loadRoomPreview } from "@/lib/seo/room-preview";

// 방 링크별 미리보기 그림. 방 상태마다 달라 요청 때 그린다.
export const dynamic = "force-dynamic";

/**
 * `sv`(공유 번호)와 `dv`(데이터 버전)가 둘 다 지금 값과 같을 때만 방 카드를 그리고 하루 캐시한다. 주소의 번호와 다른 내용을 그 주소로
 * 캐시하지 않으려는 규칙이다: 오래된 번호·다른 데이터 버전·모으는 중·서버 실패는 사이트 기본 그림(짧은 캐시)이다.
 * 주소의 `iv`(그림 버전, `roomImagePath`)는 읽지 않는다: 그리는 코드가 바뀌었을 때 주소를 달리해 캐시를 비켜 가는 값일 뿐이다.
 * 서버가 막 떠서 막차 표를 아직 읽는 중이면(`lastTrainPending`) 막차 줄 없는 카드를 짧게만 캐시한다(`/s/og`와 같은 규칙, #102).
 */
export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  const search = new URL(request.url).searchParams;
  const sv = parseShareVersion(search.get(SHARE_VERSION_PARAM));
  const dv = parseDataVersion(search);
  return ogImageResponse(async (signal) => {
    if (sv === null || dv === null || !isRoomId(roomId)) return null;
    const preview = await loadRoomPreview(normalizeRoomId(roomId), signal);
    if (!preview || preview.stage === "collecting") return null;
    if (preview.room.shareVersion !== sv || preview.dataVersion !== dv) return null;
    let confirmedPublic = false;
    let visibilityUnknown = false;
    const times = preview.station.times;
    if (
      preview.stage === "result" &&
      preview.basis.mode === "fair" &&
      times.every((t) => t.seconds !== null) &&
      mayIncludeHidden(times.map((t) => t.seconds))
    ) {
      // 같은 공유 번호에서 익명으로 확인한 공개 여부만 쓴다. 그림 값은 항상 미리보기에서 만든다.
      const room = await getRoom(normalizeRoomId(roomId), null, { signal }).catch(() => null);
      if (room?.shareVersion === sv && room.participants.length === times.length) {
        confirmedPublic = room.participants.every((p) => p.hidden === false);
      } else {
        visibilityUnknown = true;
      }
    }
    const card = roomShareCopy(preview, { confirmedPublic }).card;
    if (!card) return null;
    const provisional = visibilityUnknown || (ROOM_PREVIEW_LAST_TRAIN && preview.lastTrainPending === true);
    return { element: <SharedCard data={card} />, provisional };
  });
}
