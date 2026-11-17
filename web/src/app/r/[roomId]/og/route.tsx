import { ogImageResponse } from "@/components/og/og-response";
import { SharedCard } from "@/components/og/shared-card";
import { isRoomId, normalizeRoomId } from "@/lib/room/id";
import { roomShareCopy } from "@/lib/room/share-copy";
import { parseDataVersion, parseShareVersion, SHARE_VERSION_PARAM } from "@/lib/room/share-link";
import { loadRoomPreview } from "@/lib/seo/room-preview";

// 방 링크별 미리보기 그림. 방 상태마다 달라 요청 때 그린다.
export const dynamic = "force-dynamic";

/**
 * `sv`(공유 번호)와 `dv`(데이터 버전)가 둘 다 지금 값과 같을 때만 방 카드를 그리고 하루 캐시한다. 주소의 번호와 다른 내용을 그 주소로
 * 캐시하지 않으려는 규칙이다: 오래된 번호·다른 데이터 버전·모으는 중·서버 실패는 사이트 기본 그림(짧은 캐시)이다.
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
    const card = roomShareCopy(preview).card;
    return card ? <SharedCard data={card} /> : null;
  });
}
