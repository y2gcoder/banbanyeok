import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CreateRoomForm } from "@/components/room/create-form";
import { ROOM_MAIN, ROOM_SIDE } from "@/components/room/room-layout";
import { RoomShell } from "@/components/room/room-states";
import { newRoomMetadata } from "@/lib/seo/metadata";

export const metadata: Metadata = newRoomMetadata();

export default function Page() {
  return (
    <RoomShell split="form">
      <div className={ROOM_SIDE}>
        <nav>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-[15px] font-semibold text-ink-soft hover:text-ink"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            혼자 입력하기
          </Link>
        </nav>
        <section aria-labelledby="new-room-title" className="flex flex-col gap-2">
          <h1
            id="new-room-title"
            className="text-[28px] leading-[1.2] font-extrabold tracking-[-0.02em] text-ink lg:text-[40px] wide:text-[32px]"
          >
            친구가 각자 입력하는 방 만들기
          </h1>
          <p className="text-[15px] text-ink-soft">
            내 출발역만 넣고 링크를 보내면, 친구들이 들어와서 자기 출발역을 직접 넣어요.
          </p>
        </section>
      </div>
      <CreateRoomForm
        preserveInitialInputs
        className={`${ROOM_MAIN} wide:rounded-2xl wide:border wide:border-rule wide:bg-surface wide:p-4 wide:shadow-[0_1px_0_var(--rule)] lg:p-8`}
      />
    </RoomShell>
  );
}
