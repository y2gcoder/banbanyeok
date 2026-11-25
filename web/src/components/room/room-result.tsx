"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCwIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Candidates, LoadingCard } from "@/components/result/parts/candidates";
import type { ChoiceContext, RoomChoice } from "@/components/result/parts/directions";
import { ModeTabs } from "@/components/result/parts/mode-tabs";
import { Notices } from "@/components/result/parts/notices";
import { Button } from "@/components/ui/button";
import { TimeBasisNote } from "@/components/when/time-basis";
import { track, trackResultViewed } from "@/lib/analytics";
import type { Mode, Room } from "@/lib/api/types";
import type { ResultView } from "@/lib/result/view-model";
import { toResultView } from "@/lib/result/view-model";
import type { RoomDraw } from "@/lib/room/draw";
import { isRoomGone, roomErrorMessage } from "@/lib/room/errors";
import { roomResultQueryOptions } from "@/lib/room/queries";
import { canFavor, favorIndexOf } from "@/lib/room/view";
import { DecisionBanner } from "./decision-banner";
import type { DecisionControl } from "./use-room-decision";

/**
 * 이 화면에서의 정하기: 참여한 사람(member)은 서버에 정하고, 보기만 하는 사람(viewer)은 정할 수 없다. 공유 번호를 모르는 옛 서버의
 * 방(local)은 예전처럼 이 화면에서만 표시한다.
 */
export type RoomDecisionMode = { kind: "local" } | { kind: "viewer" } | { kind: "member"; control: DecisionControl };

type Props = {
  roomId: string;
  room: Room;
  participantToken: string | null;
  participantId: string | null;
  isHost: boolean;
  decision: RoomDecisionMode;
  /** 결과 쿼리가 방 없음(404)을 받았을 때. 방 화면이 전체를 "방이 없어요" 안내로 바꾼다(되살릴 수 없으므로 다시 시도는 두지 않는다). */
  onRoomGone: () => void;
  /** 결과가 처음 나왔을 때(이 기기 기준) 한 번. 통계의 경과 일수 기준 시각을 저장하는 데 쓴다. */
  onResultSeen: (view: ResultView) => void;
  /** 결과 화면 아래에 붙일 것(예: "실제로 어디서 만났나"). 1위 후보가 있을 때만 그린다. */
  renderAfter?: (view: ResultView) => React.ReactNode;
  /**
   * 후보 위에 붙일 '누구 쪽으로' 뽑기 카드(#172). `apply`는 그 뽑기가 화면에 자리 잡았을 때 한 번 부른다: 결과 탭을 당첨자 쪽으로
   * (뽑기 전이면 공평하게로) 옮긴다.
   */
  renderDraw?: (apply: (draw: RoomDraw) => void) => React.ReactNode;
  /**
   * 뽑기 카드를 후보 위에 둘지. 뽑기 전(방장은 거기서 뽑는다)과 이 기기가 막 뽑았을 때만 위다. 이미 뽑힌 결과는 접힌 채 후보 아래에 둬
   * 폰 첫 화면에 1위 카드가 들어오게 한다(#168). 결과 탭과 요약 줄이 이미 당첨자 쪽을 보여 준다.
   */
  drawAtTop?: boolean;
};

type Pick = { mode: Mode; favorId: string | null };

/** `currentVersion`은 보이는 결과가 지금 방의 번호로 계산됐을 때 그 번호. 아니면(새 결과를 받는 중) undefined. */
function roomChoiceOf(
  decision: RoomDecisionMode,
  currentVersion: number | undefined,
  decidedCode: string | null,
): RoomChoice | undefined {
  switch (decision.kind) {
    case "local":
      return undefined;
    case "viewer":
      return { kind: "viewer" };
    case "member": {
      const { control } = decision;
      return {
        kind: "member",
        decidedCode,
        pending: control.pending,
        decide:
          currentVersion === undefined
            ? null
            : (stationCode, onApplied) => control.decide(stationCode, currentVersion, onApplied),
      };
    }
  }
}

/**
 * 방 결과. 서버가 방 전체로 계산한다(숨긴 사람의 출발역은 가려지고 시간·환승은 보인다). 모드 탭은 보는 사람의 화면 설정이고
 * 처음 값은 방의 추천 기준·배려 대상이다. 이름은 서버 label·shortLabel이고 "(나)"는 내 토큰이 가리키는 사람에게만 붙는다.
 */
export function RoomResult({
  roomId,
  room,
  participantToken,
  participantId,
  isHost,
  decision,
  onRoomGone,
  onResultSeen,
  renderAfter,
  renderDraw,
  drawAtTop = true,
}: Props) {
  const panelId = useId();
  const queryClient = useQueryClient();
  // 배려 대상 알약은 좁은 칸이라 짧은 이름(shortLabel). 모르는 옛 서버(웹이 먼저 배포된 사이)는 label로.
  // 출발역을 숨긴 다른 사람은 고를 수 없다(그 사람 쪽 결과는 본인만 본다, #162).
  const people = room.participants.flatMap((p, index) =>
    canFavor(p) ? [{ index, name: (p.shortLabel as string | undefined) ?? p.label }] : [],
  );
  // 뽑기로 정하는 방에서 아직 안 뽑았으면 공평하게로 시작한다(서버의 방 기본 결과·미리보기와 같다, #172).
  const [pick, setPick] = useState<Pick>(() =>
    room.favorDraw && !room.favorDraw.winner
      ? { mode: "fair", favorId: null }
      : { mode: room.mode, favorId: room.favorTarget ?? null },
  );
  const applyDraw = (draw: RoomDraw) =>
    setPick(draw.winnerId ? { mode: "favor", favorId: draw.winnerId } : { mode: "fair", favorId: null });

  // 배려 대상이 방에서 빠졌으면 첫 사람으로(없는 ID를 서버에 보내지 않는다).
  const favorIndexRaw =
    pick.favorId === null ? -1 : room.participants.findIndex((p) => p.participantId === pick.favorId);
  const favorTargetIndex = favorIndexRaw >= 0 ? favorIndexRaw : (favorIndexOf(room) ?? 0);
  const favorTarget = room.participants[favorTargetIndex];
  // 그 사람이 출발역을 숨긴 다른 사람이면(방의 기본 기준이거나, 고른 뒤 숨겼다) 공평하게로 본다. 서버의 방 기본 기준·미리보기와 같은 규칙이다.
  const mode: Mode = pick.mode === "favor" && favorTarget !== undefined && !canFavor(favorTarget) ? "fair" : pick.mode;
  const favorIndex = mode === "favor" ? favorTargetIndex : null;
  const favorId = favorIndex === null ? null : (room.participants[favorIndex]?.participantId ?? null);

  const query = useQuery(roomResultQueryOptions(roomId, { mode, favor: favorId }, participantToken, participantId));
  const data = query.data;
  // 약속 날짜·시각을 넘긴다: 새벽 약속이면 그 밤 막차가 약속보다 먼저 떠날 수 있다(막차 칸이 가려낸다).
  // 방과 결과는 따로 받는다. 둘의 공유 번호가 같을 때만 그 결과의 막차를 이 방의 약속과 함께 그린다: 약속을 바꾼 직후에는 새 약속
  // 날짜와 이전 운행일의 막차가 한 카드에 섞이므로, 번호가 다르면(어느 쪽이 먼저 오든) 막차 칸은 "다시 계산하는 중"만 보인다.
  // 번호를 보내지 않는 옛 서버는 둘 다 없어 같다고 본다.
  const { meetingDate, meetingTime } = room;
  const lastTrainsCurrent = data?.shareVersion === room.shareVersion;
  const view = useMemo(
    () =>
      data
        ? toResultView(data, {
            meeting: { date: meetingDate, time: meetingTime },
            lastTrains: lastTrainsCurrent ? true : "recalculating",
          })
        : null,
    [data, meetingDate, meetingTime, lastTrainsCurrent],
  );
  const meIndex = data ? data.participants.findIndex((p) => p.isSelf === true) : -1;

  const roomGone = query.isError && isRoomGone(query.error);
  const reportGone = useRef(onRoomGone);
  reportGone.current = onRoomGone;
  useEffect(() => {
    if (roomGone) reportGone.current();
  }, [roomGone]);

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
      room: { roomId, roomHash: room.roomHash },
    });
  }, [data, view, isPlaceholder, roomId, room.roomHash]);

  // 결과 카드에서 정할 때는 보이는 결과의 번호를 보낸다. 그 번호가 방(정한 역 안내)과 같을 때만 정하게 한다: 정한 직후처럼 결과가
  // 옛 번호면 서버가 409로 거절하고, 결과가 더 새로우면 화면에 아직 없는 다른 사람의 정함을 덮어쓴다.
  const shownVersion = isPlaceholder ? undefined : data?.shareVersion;
  const roomVersion = room.shareVersion;
  useEffect(() => {
    if (shownVersion === undefined || roomVersion === undefined || shownVersion === roomVersion) return;
    if (shownVersion < roomVersion) void query.refetch({ cancelRefetch: false });
    else void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
  }, [shownVersion, roomVersion, query.refetch, queryClient, roomId]);
  const roomChoice = roomChoiceOf(
    decision,
    shownVersion !== undefined && shownVersion === roomVersion ? shownVersion : undefined,
    room.decision?.stationCode ?? null,
  );
  const choice: ChoiceContext = {
    mode,
    participantCount: room.participants.length,
    variant: isHost ? "creator" : "received",
    ...(roomChoice ? { room: roomChoice } : {}),
  };
  const undoVersion = room.shareVersion;
  const undo =
    decision.kind === "member" && undoVersion !== undefined
      ? { pending: decision.control.pending, onUndo: () => decision.control.undo(undoVersion) }
      : null;
  const notice = decision.kind === "member" ? decision.control.notice : null;
  const top = view?.candidates[0];
  // 배려 탭을 처음 누를 때 고를 사람: 고를 수 있는 사람 중 가장 오래 걸리는 사람.
  const choosable = top ? top.people.filter((p) => people.some((q) => q.index === p.index)) : [];
  const longest =
    choosable.length > 0 ? choosable.reduce((a, b) => (b.seconds > a.seconds ? b : a)).index : (people[0]?.index ?? 0);

  const change = (next: Mode, index: number | null) => {
    if (next !== mode) track("mode_switched", { from_mode: mode, to_mode: next, favor_used: next === "favor" });
    setPick({ mode: next, favorId: index === null ? null : (room.participants[index]?.participantId ?? null) });
  };

  return (
    <section aria-labelledby="result-title" className="flex flex-col gap-4">
      <DecisionBanner room={room} undo={undo} />
      {renderDraw && drawAtTop ? renderDraw(applyDraw) : null}
      {/* 뽑기 재생이 끝나 카드가 접히면 초점이 여기로 온다(1위 카드가 바로 아래, #172). */}
      <h2 id="result-title" tabIndex={-1} className="text-[20px] font-extrabold text-ink">
        만날 역 후보
      </h2>
      <ModeTabs
        mode={mode}
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
            {notice ? (
              <p
                role="alert"
                className="rounded-xl border border-destructive/40 bg-surface p-3 text-[14px] font-semibold text-destructive"
              >
                {notice}
              </p>
            ) : null}
            <Notices notices={view.notices} onFavor={(index) => change("favor", index)} />
            <Candidates view={view} meIndex={meIndex >= 0 ? meIndex : null} choice={choice} />
          </>
        ) : query.isError && !roomGone ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-rule bg-surface p-5">
            <p className="text-[15px] text-ink">{roomErrorMessage(query.error)}</p>
            <Button type="button" variant="outline" onClick={() => void query.refetch()} className="h-11">
              <RotateCwIcon aria-hidden="true" />
              다시 시도
            </Button>
          </div>
        ) : (
          // 방 없음(404)이면 방 화면이 곧 안내로 바꾸므로 한 프레임이라도 오류 카드를 그리지 않는다.
          <LoadingCard />
        )}
      </div>
      {renderDraw && !drawAtTop ? renderDraw(applyDraw) : null}
      <TimeBasisNote basis={data ? (data.timeBasis ?? null) : undefined} requested={null} />
      {view && top && renderAfter ? renderAfter(view) : null}
    </section>
  );
}
