"use client";

import { useQuery } from "@tanstack/react-query";
import { ShareActions } from "@/components/share/share-actions";
import type { Room } from "@/lib/api/types";
import { roomPreviewQueryOptions } from "@/lib/room/queries";
import { INVITE_COPY, roomShareCopy, type ShareStage } from "@/lib/room/share-copy";
import { roomShareLink } from "@/lib/room/share-link";
import { cn } from "@/lib/utils";

/** 링크를 보낼 때 미리보기에 무엇이 보이는지. 카톡이 한 번 만든 미리보기는 고칠 수 없다는 것도 함께 알린다(#51). */
const HINTS: Record<ShareStage, string | null> = {
  collecting: null,
  result: "카톡 미리보기에 지금 1위 역과 각자 시간이 보여요. 이미 보낸 미리보기는 나중에 바뀌지 않아요.",
  decided: "카톡 미리보기에 정한 역과 각자 시간이 보여요. 이미 보낸 미리보기는 나중에 바뀌지 않아요.",
};

/**
 * 방 화면의 공유 칸(하나). 링크와 문구는 같은 미리보기(`roomShareCopy`)에서 나온다: 링크의 번호는 그 미리보기를 만든 방의 번호다.
 * 미리보기는 방의 공유 번호가 바뀔 때 미리 받아 둔다(버튼을 누른 뒤 네트워크를 기다리면 iOS가 공유 시트를 열어 주지 않는다).
 * 못 받았거나 받는 중이면 번호 없는 링크와 초대 문구(서로 맞는 한 쌍)를 쓴다.
 */
export function RoomShareSection({ roomId, room }: { roomId: string; room: Room }) {
  const query = useQuery(roomPreviewQueryOptions(roomId, room.shareVersion));
  const preview = query.data;
  const copy = preview ? roomShareCopy(preview) : INVITE_COPY;
  const path = roomShareLink(roomId, preview?.room.shareVersion);
  const alone = room.participants.length < 2;
  const hint = alone
    ? "친구가 링크로 들어와 자기 출발역을 넣으면 여기에 나타나요. 두 명 이상 모이면 결과를 볼 수 있어요."
    : HINTS[copy.stage];

  return (
    <section
      aria-labelledby="share-title"
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-surface p-5",
        alone ? "border-2 border-ink" : "border border-rule",
      )}
    >
      <h2 id="share-title" className="text-[18px] font-extrabold text-ink">
        {alone ? "친구에게 링크를 보내 주세요" : "링크 다시 보내기"}
      </h2>
      {hint ? <p className="text-[14px] text-ink-soft">{hint}</p> : null}
      <ShareActions
        path={path}
        title={copy.message.title}
        text={copy.message.text}
        button={copy.message.button}
        linkType="room"
        room={{ roomId, roomHash: room.roomHash, stage: copy.stage }}
      />
    </section>
  );
}
