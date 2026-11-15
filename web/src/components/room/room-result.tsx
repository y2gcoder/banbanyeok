"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChoiceContext } from "@/components/result/directions";
import { ModeTabs } from "@/components/result/mode-tabs";
import { Notices } from "@/components/result/notices";
import { Candidates, LoadingCard } from "@/components/result/result-screen";
import { Button } from "@/components/ui/button";
import { TimeBasisNote } from "@/components/when/time-basis";
import { track, trackResultViewed } from "@/lib/analytics";
import type { Mode, Room } from "@/lib/api/types";
import type { ResultView } from "@/lib/result/view-model";
import { toResultView } from "@/lib/result/view-model";
import { roomErrorMessage } from "@/lib/room/errors";
import { roomResultQueryOptions } from "@/lib/room/queries";
import { favorIndexOf } from "@/lib/room/view";
import { slotForMeeting } from "@/lib/when/time-slot";

type Props = {
  roomId: string;
  room: Room;
  participantToken: string | null;
  participantId: string | null;
  isHost: boolean;
  /** 결과가 처음 나왔을 때(이 기기 기준) 한 번. 통계의 경과 일수 기준 시각을 저장하는 데 쓴다. */
  onResultSeen: (view: ResultView) => void;
  /** 결과 화면 아래에 붙일 것(예: "실제로 어디서 만났나"). 1위 후보가 있을 때만 그린다. */
  renderAfter?: (view: ResultView) => React.ReactNode;
};

type Pick = { mode: Mode; favorId: string | null };

/**
 * 방 결과. 서버가 방 전체로 계산한다(숨긴 사람의 출발역은 가려지고 시간·환승은 보인다). 모드 탭은 보는 사람의 화면 설정이고
 * 처음 값은 방의 추천 기준·배려 대상이다. 이름은 서버 label이고 "(나)"는 내 토큰이 가리키는 사람에게만 붙는다.
 */
export function RoomResult({
  roomId,
  room,
  participantToken,
  participantId,
  isHost,
  onResultSeen,
  renderAfter,
}: Props) {
  const panelId = useId();
  const people = room.participants.map((p, index) => ({ index, name: p.label }));
  const [pick, setPick] = useState<Pick>(() => ({ mode: room.mode, favorId: room.favorTarget ?? null }));

  // 배려 대상이 방에서 빠졌으면 첫 사람으로(없는 ID를 서버에 보내지 않는다).
  const favorIndexRaw =
    pick.favorId === null ? -1 : room.participants.findIndex((p) => p.participantId === pick.favorId);
  const favorIndex = pick.mode === "favor" ? (favorIndexRaw >= 0 ? favorIndexRaw : (favorIndexOf(room) ?? 0)) : null;
  const favorId = favorIndex === null ? null : (room.participants[favorIndex]?.participantId ?? null);

  const query = useQuery(
    roomResultQueryOptions(roomId, { mode: pick.mode, favor: favorId }, participantToken, participantId),
  );
  const data = query.data;
  const view = useMemo(() => (data ? toResultView(data) : null), [data]);
  const meIndex = data ? data.participants.findIndex((p) => p.isSelf === true) : -1;

  const viewed = useRef<unknown>(null);
  const isPlaceholder = query.isPlaceholderData;
  const reportSeen = useRef(onResultSeen);
  reportSeen.current = onResultSeen;
  useEffect(() => {
    if (!data || !view || isPlaceholder || viewed.current === data) return;
    viewed.current = data;
    reportSeen.current(view);
    trackResultViewed({
      participantCount: data.participants.length,
      mode: data.mode,
      topMaxMinutes: view.candidates[0]?.aggregate.max,
      candidateCount: view.candidates.length,
      topStationCode: view.candidates[0]?.stationCode,
      dataVersion: view.dataVersion,
      responseMs: undefined,
    });
  }, [data, view, isPlaceholder]);

  const choice: ChoiceContext = {
    mode: pick.mode,
    participantCount: room.participants.length,
    variant: isHost ? "creator" : "received",
  };
  const top = view?.candidates[0];
  const longest = top ? top.people.reduce((a, b) => (b.seconds > a.seconds ? b : a)).index : 0;

  const change = (mode: Mode, index: number | null) => {
    if (mode !== pick.mode)
      track("mode_switched", { from_mode: pick.mode, to_mode: mode, favor_used: mode === "favor" });
    setPick({ mode, favorId: index === null ? null : (room.participants[index]?.participantId ?? null) });
  };

  return (
    <section aria-labelledby="result-title" className="flex flex-col gap-4">
      <h2 id="result-title" className="text-[20px] font-extrabold text-ink">
        만날 역 후보
      </h2>
      <ModeTabs
        mode={pick.mode}
        favorIndex={favorIndex}
        people={people}
        onChange={change}
        defaultFavorIndex={longest}
        label="추천 기준"
        panelId={panelId}
      />
      <div id={panelId} role="tabpanel" aria-busy={query.isFetching} className="flex flex-col gap-4">
        {view ? (
          <>
            <Notices notices={view.notices} onFavor={(index) => change("favor", index)} />
            <Candidates view={view} meIndex={meIndex >= 0 ? meIndex : null} choice={choice} />
          </>
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-rule bg-surface p-5">
            <p className="text-[15px] text-ink">{roomErrorMessage(query.error)}</p>
            <Button type="button" variant="outline" onClick={() => void query.refetch()} className="h-11">
              <RotateCwIcon aria-hidden="true" />
              다시 시도
            </Button>
          </div>
        ) : (
          <LoadingCard />
        )}
      </div>
      <TimeBasisNote
        basis={data ? (data.timeBasis ?? null) : undefined}
        requested={slotForMeeting(room.meetingDate ?? null, room.meetingTime ?? null)}
      />
      {view && top && renderAfter ? renderAfter(view) : null}
    </section>
  );
}
