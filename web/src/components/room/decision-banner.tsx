import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Room } from "@/lib/api/types";
import { withJosa } from "@/lib/display/korean";
import { meetingWhenText } from "@/lib/room/dates";

/**
 * 방에서 정한 만날 역: 역, 정한 사람, 약속. 참여한 사람에게는 풀기 버튼을 둔다(풀면 모두에게서 사라진다).
 * 정한 사람이 방을 나가거나 누가 들어오거나 출발역을 바꾸면 서버가 정함을 풀므로, 정한 사람은 늘 방에 있다.
 */
export function DecisionBanner({ room, undo }: { room: Room; undo: { pending: boolean; onUndo: () => void } | null }) {
  const decision = room.decision;
  if (!decision) return null;
  const decider = room.participants.find((p) => p.participantId === decision.decidedBy);
  const by = decider?.isSelf ? "내가 정했어요" : `${withJosa(decider?.label ?? "누군가", "이/가")} 정했어요`;
  const when = meetingWhenText(room.meetingDate ?? null, room.meetingTime ?? null, room.meetingBand ?? null);
  return (
    <section
      aria-labelledby="decision-title"
      className="flex flex-col gap-2 rounded-2xl border-2 border-ink bg-surface p-5"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-soft">
        <CheckIcon className="size-4" aria-hidden="true" />
        만날 역을 정했어요
      </p>
      <h2 id="decision-title" className="text-[22px] font-extrabold leading-tight text-ink">
        {decision.stationName}에서 만나요
      </h2>
      <p className="text-[14px] text-ink-soft">{when ? `${by} · ${when}` : by}</p>
      {undo ? (
        <Button
          type="button"
          variant="outline"
          disabled={undo.pending}
          onClick={undo.onUndo}
          className="mt-1 h-11 self-start text-[15px] font-semibold"
        >
          정한 역 풀기
        </Button>
      ) : null}
    </section>
  );
}
