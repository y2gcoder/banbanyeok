"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { roomHashProperty, track } from "@/lib/analytics";
import type { Room } from "@/lib/api/types";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { MAX_PEOPLE } from "@/lib/link/codec";
import { roomDraw } from "@/lib/room/draw";
import { isRoomGone, roomErrorMessage } from "@/lib/room/errors";
import { normalizeRoomId } from "@/lib/room/id";
import type { ParticipantFormValue } from "@/lib/room/input";
import { roomQueryOptions } from "@/lib/room/queries";
import {
  canStoreRoomTokens,
  loadRoomRecord,
  type RoomRecord,
  removeRoomRecord,
  withoutParticipant,
  writeRoomRecord,
} from "@/lib/room/tokens";
import { canFavor, hasStaleParticipantToken, joinState, roomPeople } from "@/lib/room/view";
import { stationByCode } from "@/lib/stations";
import { isMeetingDayReached, meetingWhenText, todayInSeoul } from "@/lib/when/dates";
import { FavorDrawCard } from "./draw/favor-draw-card";
import { HostControls } from "./host-controls";
import { JoinForm } from "./join-form";
import { JumpButton } from "./jump-button";
import { OutcomeCard } from "./outcome-card";
import { PEOPLE_TITLE_ID, PeopleList } from "./people-list";
import { type RoomDecisionMode, RoomResult } from "./room-result";
import {
  CannotJoin,
  ROOM_MAIN,
  ROOM_SIDE,
  RoomGone,
  RoomIntro,
  RoomLoadError,
  RoomLoading,
  RoomShell,
} from "./room-states";
import { RoomShareSection } from "./share-section";
import { useFavorDraw } from "./use-favor-draw";
import { useIdempotencyKey } from "./use-idempotency-key";
import { useRoomActions } from "./use-room-actions";
import { useRoomDecision } from "./use-room-decision";

/** 결과 위 "나도 출발역 넣기"가 옮겨 갈 참여 폼 자리. */
const JOIN_FORM_ID = "join-form";

const emptyValue = (): ParticipantFormValue => ({ nickname: "", station: null, hidden: false });

/** 기억해 둔 "나"로 참여 폼의 처음 값을 만든다(역을 숨기는 설정까지 기억하지는 않는다). */
function rememberedValue(): ParticipantFormValue {
  const me = loadRememberedMe();
  const station = me ? stationByCode(me.code) : undefined;
  return me && station?.supported ? { nickname: me.nickname, station, hidden: false } : emptyValue();
}

/**
 * 방 설정 요약의 기준: "공평하게" / "빨리 만나기" / "{짧은 이름} 쪽으로"(배려 대상을 아직 모르면 "누구 쪽으로").
 * 배려 대상이 출발역을 숨긴 다른 사람이면 결과 화면·미리보기처럼 "공평하게"다(#162). 뽑기로 정하는 방은 "(뽑기)"를 붙이고, 아직 안
 * 뽑았으면 그렇다고 적는다(#172).
 */
function modeText(room: Room): string {
  if (room.mode === "fair") return "공평하게";
  if (room.mode === "fast") return "빨리 만나기";
  const target = room.participants.find((p) => p.participantId === room.favorTarget);
  if (room.favorDraw && !target) return "누구 쪽으로(뽑기) · 아직 안 뽑았어요";
  if (target && !canFavor(target)) return "공평하게";
  // shortLabel을 모르는 옛 서버(웹이 먼저 배포된 사이)는 label로 쓴다.
  const name = target ? ((target.shortLabel as string | undefined) ?? target.label) : "누구";
  return room.favorDraw ? `${name} 쪽으로(뽑기)` : `${name} 쪽으로`;
}

function summary(room: Room): string {
  const parts = [modeText(room)];
  // 시간대만 고른 방은 시각이 없다: "11월 21일 (토) 저녁". 시간대를 모르는 옛 서버는 meetingBand를 보내지 않는다.
  const when = meetingWhenText(room.meetingDate ?? null, room.meetingTime ?? null, room.meetingBand ?? null);
  if (when) parts.push(`약속 ${when}`);
  return parts.join(" · ");
}

/**
 * 방 화면: 링크로 들어온 사람의 첫 화면이자 만든 사람이 돌아오는 화면. 열리자마자 서버를 깨우고(콜드스타트),
 * 이 기기에 저장된 토큰(방별 localStorage)으로 "내 항목"을 찾는다. 토큰은 헤더로만 보내고 화면·주소·통계에 두지 않는다.
 */
export function RoomScreen({ roomId: rawRoomId }: { roomId: string }) {
  const roomId = normalizeRoomId(rawRoomId);
  const keys = useIdempotencyKey();
  // undefined = 아직 기기 저장소를 읽지 않음(서버 렌더링·수화 직후), null = 기록 없음
  const [record, setRecord] = useState<RoomRecord | null | undefined>(undefined);
  const [joinValue, setJoinValue] = useState<ParticipantFormValue>(emptyValue);
  const [storable, setStorable] = useState(true);
  // 결과 쿼리가 방 없음(404)을 먼저 받았을 때(방 쿼리는 이전 data를 유지한다). 방이 지워지면 되살릴 수 없다.
  const [resultGone, setResultGone] = useState(false);

  // 화면의 기록(상태)과 기기 저장소를 같이 바꾼다. 저장소가 막혀 있어도 상태에는 남아 이번 방문 동안은 방금 받은 토큰을 쓴다
  // (참여는 성공했는데 실패처럼 보여 다시 제출하면 중복 참가자가 생기는 일을 막는다).
  const commit = useCallback(
    (next: RoomRecord | null) => {
      setRecord(next);
      writeRoomRecord(roomId, next);
    },
    [roomId],
  );

  useEffect(() => {
    // 방 조회는 이 효과 다음 렌더에서 바로 나간다(그 요청이 서버를 깨운다). 따로 미리 깨우지 않는다.
    setRecord(loadRoomRecord(roomId));
    setResultGone(false);
    setJoinValue(rememberedValue());
    setStorable(canStoreRoomTokens());
  }, [roomId]);

  const token = record?.participantToken ?? null;
  const participantId = record?.participantId ?? null;
  // 방이 없다는 답이 오면 되살릴 수 없으므로 더는 다시 불러오지 않는다. 방 쿼리 자신의 404는 queries.ts가 폴링·포커스 재요청을
  // 멈추고, 결과 쿼리가 먼저 받은 404는 여기서 방 쿼리를 끈다.
  const query = useQuery({
    ...roomQueryOptions(roomId, token, participantId),
    enabled: record !== undefined && !resultGone,
  });
  const room = query.data;
  // TanStack은 다시 불러오기가 실패해도 이전 data를 유지한다. 방이 없다는 답은 이전 화면을 남기지 않고 곧바로 안내로 바꾼다.
  const gone = resultGone || (query.isError && isRoomGone(query.error));

  // 방 응답으로 기기 기록을 맞춘다: 서버가 방이 없다고 하면 기록 삭제, 내보내졌으면 참여자 토큰 정리.
  // 저장해 둔 시각만 보고 지우지 않는다(서버는 활동마다 만료를 미룬다).
  useEffect(() => {
    if (record === undefined) return;
    if (gone) {
      removeRoomRecord(roomId);
      return;
    }
    if (!room || query.isPlaceholderData || !record) return;
    if (hasStaleParticipantToken(room, record)) {
      commit(withoutParticipant(record));
      keys.renew(); // 같은 입력으로 다시 참여할 때 지난 응답(죽은 토큰)을 재생받지 않게
    }
  }, [record, room, gone, query.isPlaceholderData, roomId, commit, keys]);

  const actions = useRoomActions({ roomId, room, record, commit, keys });

  const decisionControl = useRoomDecision({ roomId, participantToken: token, participantId, refresh: actions.refresh });
  const drawControl = useFavorDraw({ roomId, hostToken: record?.hostToken });
  // 이 기기에 기록이 없는 사람(보기만 함)이 이번 방문에 그림을 본 뽑기. 기록이 있으면 기록(drawSeen)에 둔다.
  const [seenDraws, setSeenDraws] = useState<ReadonlySet<string>>(() => new Set());

  const people = useMemo(() => (room ? roomPeople(room) : []), [room]);

  // 정원이 찬 방에 들어오려던 사람(참여하지 않았고 방장도 아님): 인원 상한 수요로 한 번만 센다. 방장이 예상 인원을 4로 고르는 것은 세지 않는다.
  const cannotJoinFull = room !== undefined && !record?.hostToken && joinState(room) === "full";
  // 어느 방에서 보냈는지 기억한다: 같은 방에서는 1회, 다른 방으로 옮겨 가면(roomId가 바뀌면) 다시 센다.
  const fullReportedFor = useRef<string | null>(null);
  const roomHash = room?.roomHash;
  useEffect(() => {
    if (!cannotJoinFull || fullReportedFor.current === roomId) return;
    fullReportedFor.current = roomId;
    track("people_limit_hit", { surface: "room_full", ...roomHashProperty({ roomId, roomHash }) });
  }, [cannotJoinFull, roomId, roomHash]);

  if (record === undefined || (query.isPending && !room)) return <RoomLoading />;
  if (gone) return <RoomGone />;
  if (query.isError && !room) {
    return <RoomLoadError message={roomErrorMessage(query.error)} onRetry={() => void query.refetch()} />;
  }
  if (!room) return <RoomLoading />;

  const state = joinState(room);
  const joined = state === "joined";
  const isHost = Boolean(record?.hostToken);
  const selfIndex = people.findIndex((p) => p.isSelf);
  const myValue = (): ParticipantFormValue => {
    const self = room.participants.find((p) => p.isSelf === true);
    const station = self?.originCode ? stationByCode(self.originCode) : undefined;
    return {
      // 이름은 사람이 넣은 원문(nickname)만 채운다. label("참가자 N" 등)을 이름 칸에 넣지 않는다.
      nickname: self?.nickname ?? "",
      station: station ?? null,
      hidden: self?.hidden ?? false,
    };
  };
  const today = todayInSeoul();
  const meetingDay = isMeetingDayReached(room.meetingDate, today) || !room.meetingDate;
  const enough = room.participants.length >= 2;
  // 방장이 정한 예상 인원이 찼으면 잠금 버튼으로는 열 수 없다(서버가 정원 도달을 locked로 돌려준다).
  const fullByCount =
    room.locked && Boolean(record?.expectedCount) && room.participants.length >= (record?.expectedCount ?? 5);
  const decision: RoomDecisionMode =
    room.shareVersion === undefined
      ? { kind: "local" }
      : joined && token
        ? { kind: "member", control: decisionControl }
        : { kind: "viewer" };
  // 공유 칸은 하나다. 혼자일 때는 링크 보내기가 가장 먼저 할 일이라 맨 위, 둘 이상이면 결과 아래(참여자 목록 다음).
  const share = joined ? <RoomShareSection roomId={roomId} room={room} /> : null;
  const canJoinHere = !joined && state === "can-join";

  // 참여자 목록·내 항목 고치기·참여 폼·못 들어오는 안내. 결과가 있으면 폰에서 1위가 첫 화면에 들어오도록 결과 아래에 둔다(#168).
  const roomPeopleBlock = (
    <>
      <PeopleList
        people={people}
        maxPeople={MAX_PEOPLE}
        canKick={isHost}
        editing={actions.editing}
        busy={actions.busy}
        onEditSelf={actions.startEdit}
        onRemoveSelf={actions.leave}
        onKick={actions.kick}
      />
      {actions.actionError && !isHost ? (
        <p role="alert" className="-mt-2 text-sm font-semibold text-destructive">
          {actions.actionError}
        </p>
      ) : null}

      {joined && actions.editing ? (
        <JoinForm
          key="edit"
          mode="edit"
          initial={myValue()}
          personIndex={Math.max(0, selfIndex)}
          pending={actions.editPending}
          timeBasis={room.timeBasis}
          error={actions.editError}
          onSubmit={(input, value) => {
            if (value.station) saveRememberedMe({ code: value.station.code, nickname: value.nickname.trim() });
            actions.edit(input);
          }}
          onCancel={actions.cancelEdit}
        />
      ) : null}

      {canJoinHere ? (
        <>
          <div id={JOIN_FORM_ID} className="scroll-mt-4">
            <JoinForm
              key="join"
              mode="join"
              initial={joinValue}
              personIndex={room.participants.length}
              pending={actions.joinPending}
              timeBasis={room.timeBasis}
              error={actions.joinError}
              onSubmit={(input, value) => {
                if (value.station) saveRememberedMe({ code: value.station.code, nickname: value.nickname.trim() });
                actions.join(input);
              }}
            />
          </div>
          {storable ? null : (
            <p role="status" className="-mt-2 text-[13px] text-destructive">
              이 브라우저는 저장 공간을 막아 두어서, 참여한 뒤 이 기기에서 내 항목을 고칠 수 없어요.
            </p>
          )}
        </>
      ) : null}
      {!joined && (state === "full" || state === "locked") ? <CannotJoin reason={state} /> : null}
    </>
  );

  const draw = roomDraw(room);
  const expectedCount = record?.expectedCount ?? null;
  const drawSeen = (key: string) => (record ? record.drawSeen === key : seenDraws.has(key));
  const renderDraw = draw
    ? (apply: (settled: NonNullable<typeof draw>) => void) => (
        <FavorDrawCard
          key={draw.key}
          roomId={roomId}
          draw={draw}
          viewer={isHost ? "host" : draw.selfLate ? "late" : "member"}
          full={expectedCount === null ? null : room.participants.length >= expectedCount}
          joinedCount={room.participants.length}
          expectedCount={expectedCount}
          seen={drawSeen(draw.key)}
          justDrew={draw.winner !== null && drawControl.drewKey === draw.key}
          pending={drawControl.pending}
          error={drawControl.error}
          onDraw={drawControl.draw}
          onSettled={(settled) => {
            apply(settled);
            if (settled.winner === null || drawSeen(settled.key)) return;
            if (record) commit({ ...record, drawSeen: settled.key });
            else setSeenDraws((seen) => new Set(seen).add(settled.key));
          }}
        />
      )
    : undefined;

  const result = (
    <RoomResult
      roomId={roomId}
      room={room}
      participantToken={token}
      participantId={participantId}
      isHost={isHost}
      decision={decision}
      onRoomGone={() => setResultGone(true)}
      onResultSeen={() => {
        if (record && !record.resultSeenAt) commit({ ...record, resultSeenAt: new Date().toISOString() });
      }}
      {...(renderDraw ? { renderDraw } : {})}
      renderAfter={(view) =>
        joined && token && meetingDay ? (
          <OutcomeCard
            roomId={roomId}
            participantToken={token}
            topStationCode={view.candidates[0]?.stationCode ?? ""}
            roomHash={room.roomHash}
            resultSeenAt={record?.resultSeenAt}
            answered={Boolean(record?.outcomeAnswered)}
            collapsed={!room.meetingDate}
            onAnswered={() => record && commit({ ...record, outcomeAnswered: true })}
          />
        ) : null
      }
    />
  );

  // 배치(#168). 폰(한 칸)은 문서 순서대로 보인다:
  // - 결과 전(1명): 소개 → 링크 보내기 → 참여자·참여 폼 → "두 명 이상…" → 방장 설정
  // - 결과 있음:    소개 → (참여 전) 나도 출발역 넣기 → 결과 → 참여자·참여 폼 → 링크 다시 보내기 → 방장 설정
  // 참여자·참여 폼 묶음은 두 경우 모두 RoomShell 자식 중 같은 자리(소개 묶음·결과 자리 다음)에 둔다. 두 번째 사람이 들어와 결과가 생겨도 이 묶음은
  // 다시 그려지지 않고(넣던 이름·역 검색어·포커스가 그대로) 결과와 안내 칸이 그 앞뒤 자리에 들고 난다. 빈 자리는 null로 둔다.
  // 두 칸(wide)에서는 MAIN이 오른쪽 칸 전체, SIDE 셋이 왼쪽 칸에 차례로 쌓인다.
  return (
    <RoomShell split="room">
      <div className={ROOM_SIDE}>
        <RoomIntro
          title={isHost ? "내가 만든 방" : "함께 정하는 만날 역"}
          brief={enough}
          aside={
            enough ? (
              <JumpButton targetId={PEOPLE_TITLE_ID} focus="self" className="-my-2 -mr-2 wide:hidden">
                들어온 사람 {people.length}/{MAX_PEOPLE}명
              </JumpButton>
            ) : null
          }
        />
        <p className="-mt-3 text-[14px] font-semibold text-ink-soft">{summary(room)}</p>
        {enough ? (
          canJoinHere ? (
            <JumpButton targetId={JOIN_FORM_ID} focus="input" primary className="wide:hidden">
              나도 출발역 넣기
            </JumpButton>
          ) : null
        ) : (
          share
        )}
      </div>

      {enough ? <div className={ROOM_MAIN}>{result}</div> : null}

      <div className={ROOM_SIDE}>
        {roomPeopleBlock}
        {enough ? share : null}
      </div>

      {enough ? null : (
        <div className={ROOM_MAIN}>
          <section role="status" className="rounded-2xl border border-rule bg-surface p-5 text-[15px] text-ink-soft">
            두 명 이상 들어오면 결과를 볼 수 있어요.
          </section>
        </div>
      )}

      <div className={ROOM_SIDE}>
        {isHost ? (
          <HostControls
            locked={room.locked}
            lockedByCount={fullByCount}
            busy={actions.busy}
            error={actions.actionError}
            onToggleLock={actions.lock}
            onDeleteRoom={actions.remove}
          />
        ) : null}

        <p className="text-center text-xs text-muted-foreground">
          약속일을 정했다면 약속 다음 날, 아니면 마지막 변경 후 7일 뒤에 방이 사라져요(만든 뒤 최대 30일).
        </p>
      </div>
    </RoomShell>
  );
}
