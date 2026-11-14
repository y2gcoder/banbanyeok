import type { Metadata } from "next";
import { RoomScreen } from "@/components/room/room-screen";
import { RoomGone } from "@/components/room/room-states";
import { isRoomId } from "@/lib/room/id";
import { roomLinkMetadata } from "@/lib/seo/metadata";

/**
 * 방 링크. 미리보기는 방 ID·참여자와 무관한 일반 문구다(서버를 부르지 않는다). 화면은 전부 브라우저에서 방을 불러온다:
 * 이 서버 렌더링은 얇게 두어(서버 호출·스트리밍 없음) Workers의 요청당 CPU를 아낀다.
 */
export const metadata: Metadata = roomLinkMetadata();

export default async function Page({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  // 형식이 틀린 주소는 서버에 묻지 않고 바로 "없는 방"으로 안내한다.
  if (!isRoomId(roomId)) return <RoomGone />;
  return <RoomScreen roomId={roomId} />;
}
