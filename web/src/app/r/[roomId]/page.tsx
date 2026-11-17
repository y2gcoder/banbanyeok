import type { Metadata } from "next";
import { RoomScreen } from "@/components/room/room-screen";
import { RoomGone } from "@/components/room/room-states";
import { isRoomId, normalizeRoomId } from "@/lib/room/id";
import { parseShareVersion, SHARE_VERSION_PARAM } from "@/lib/room/share-link";
import { roomLinkMetadata } from "@/lib/seo/metadata";
import { roomShareMetadata } from "@/lib/seo/room-preview";

type Props = {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * 방 링크의 미리보기. 공유 번호가 없거나 잘못된 링크(`/r/<id>`)는 방 ID·참여자와 무관한 일반 문구이고 서버를 부르지 않는다.
 * 공유 버튼이 만든 링크(`/r/<id>?sv=<n>`)만 방 미리보기를 한 번 받아 그 방의 지금 단계(초대·결과·정한 역)를 보여 준다.
 * 화면은 전부 브라우저에서 방을 불러온다(번호는 화면에 쓰지 않는다): 이 서버 렌더링은 얇게 두어 Workers의 요청당 CPU를 아낀다.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { roomId } = await params;
  const sv = parseShareVersion((await searchParams)[SHARE_VERSION_PARAM]);
  if (sv === null || !isRoomId(roomId)) return roomLinkMetadata();
  return roomShareMetadata(normalizeRoomId(roomId), sv);
}

export default async function Page({ params }: Pick<Props, "params">) {
  const { roomId } = await params;
  // 형식이 틀린 주소는 서버에 묻지 않고 바로 "없는 방"으로 안내한다.
  if (!isRoomId(roomId)) return <RoomGone />;
  return <RoomScreen roomId={roomId} />;
}
