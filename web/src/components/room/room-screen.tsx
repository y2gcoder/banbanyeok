"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShareActions } from "@/components/share/share-actions";
import { track } from "@/lib/analytics";
import { deleteRoom, joinRoom, removeParticipant, updateParticipant, updateRoom } from "@/lib/api/rooms";
import type { ParticipantInput, Room } from "@/lib/api/types";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { MAX_PEOPLE } from "@/lib/link/codec";
import { isMeetingDayReached, meetingWhenText, todayInSeoul } from "@/lib/room/dates";
import { errorCode, isRoomGone, isTokenRejected, roomErrorMessage } from "@/lib/room/errors";
import { normalizeRoomId, roomPath } from "@/lib/room/id";
import type { ParticipantFormValue } from "@/lib/room/input";
import { roomQueryOptions } from "@/lib/room/queries";
import {
  canStoreRoomTokens,
  keepUntilFrom,
  loadRoomRecord,
  type RoomRecord,
  removeRoomRecord,
  withoutParticipant,
  writeRoomRecord,
} from "@/lib/room/tokens";
import { hasStaleParticipantToken, joinState, roomPeople } from "@/lib/room/view";
import { stationByCode } from "@/lib/stations";
import { HostControls } from "./host-controls";
import { JoinForm } from "./join-form";
import { OutcomeCard } from "./outcome-card";
import { PeopleList } from "./people-list";
import { RoomResult } from "./room-result";
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
import { useIdempotencyKey } from "./use-idempotency-key";

const SHARE_TITLE = "같이 만날 역 정해요";
const SHARE_TEXT = "각자 출발역을 넣으면 모두에게 공평한 만날 역을 계산해 줘요. 출발역은 숨길 수도 있어요.";

const FULL_LOCK_REASON = "정한 예상 인원이 다 차서 잠겨 있어요. 누가 나가면 자동으로 다시 열려요.";

const emptyValue = (): ParticipantFormValue => ({ nickname: "", station: null, hidden: false });

/** 기억해 둔 "나"로 참여 폼의 처음 값을 만든다(역을 숨기는 설정까지 기억하지는 않는다). */
function rememberedValue(): ParticipantFormValue {
  const me = loadRememberedMe();
  const station = me ? stationByCode(me.code) : undefined;
  return me && station?.supported ? { nickname: me.nickname, station, hidden: false } : emptyValue();
}

/** 방 설정 요약의 기준: "공평하게" / "빨리 만나기" / "{짧은 이름} 쪽으로"(배려 대상을 아직 모르면 "누구 쪽으로"). */
function modeText(room: Room): string {
  if (room.mode === "fair") return "공평하게";
  if (room.mode === "fast") return "빨리 만나기";
  const target = room.participants.find((p) => p.participantId === room.favorTarget);
  // shortLabel을 모르는 옛 서버(웹이 먼저 배포된 사이)는 label로 쓴다.
  const name = target ? ((target.shortLabel as string | undefined) ?? target.label) : "누구";
  return `${name} 쪽으로`;
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
  const router = useRouter();
  const queryClient = useQueryClient();
  const keys = useIdempotencyKey();
  // undefined = 아직 기기 저장소를 읽지 않음(서버 렌더링·수화 직후), null = 기록 없음
  const [record, setRecord] = useState<RoomRecord | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [joinValue, setJoinValue] = useState<ParticipantFormValue>(emptyValue);
  const [storable, setStorable] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);

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
    setJoinValue(rememberedValue());
    setStorable(canStoreRoomTokens());
  }, [roomId]);

  const token = record?.participantToken ?? null;
  const participantId = record?.participantId ?? null;
  const query = useQuery({ ...roomQueryOptions(roomId, token, participantId), enabled: record !== undefined });
  const room = query.data;

  // 방 응답으로 기기 기록을 맞춘다: 서버가 방이 없다고 하면 기록 삭제, 내보내졌으면 참여자 토큰 정리.
  // 저장해 둔 시각만 보고 지우지 않는다(서버는 활동마다 만료를 미룬다).
  useEffect(() => {
    if (record === undefined) return;
    if (query.isError && isRoomGone(query.error)) {
      removeRoomRecord(roomId);
      return;
    }
    if (!room || query.isPlaceholderData || !record) return;
    if (hasStaleParticipantToken(room, record)) {
      commit(withoutParticipant(record));
      keys.renew(); // 같은 입력으로 다시 참여할 때 지난 응답(죽은 토큰)을 재생받지 않게
    }
  }, [record, room, query.isError, query.error, query.isPlaceholderData, roomId, commit, keys]);

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["room", roomId] });
    void queryClient.invalidateQueries({ queryKey: ["room-result", roomId] });
  }, [queryClient, roomId]);

  const reportMutationError = (error: unknown) => {
    setActionError(roomErrorMessage(error));
    if (isRoomGone(error)) refresh();
  };

  const join = useMutation({
    mutationFn: (input: ParticipantInput) => joinRoom(roomId, input, keys.keyFor(input)),
    onSuccess: (joined, input) => {
      commit({
        v: 1,
        ...(record?.hostToken ? { hostToken: record.hostToken } : {}),
        participantToken: joined.participantToken,
        participantId: joined.participantId,
        keepUntil: record?.keepUntil ?? keepUntilFrom(),
        ...(record?.expectedCount ? { expectedCount: record.expectedCount } : {}),
      });
      keys.renew();
      track("participant_joined", { hidden: input.hidden === true });
      refresh();
    },
    onError: (error) => {
      // 잠김·정원 초과·사라진 방이면 화면의 방 상태가 오래된 것이다. 다시 불러 안내를 바꾼다.
      const code = errorCode(error);
      if (code === "ROOM_FULL" || code === "ROOM_LOCKED" || code === "ROOM_NOT_FOUND") refresh();
    },
  });

  const edit = useMutation({
    mutationFn: (input: ParticipantInput) => {
      if (!token || !participantId) throw new Error("no participant");
      return updateParticipant(roomId, participantId, token, input);
    },
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
    onError: (error) => {
      if (isTokenRejected(error)) refresh();
    },
  });

  const leave = useMutation({
    mutationFn: () => {
      if (!token || !participantId) throw new Error("no participant");
      return removeParticipant(roomId, participantId, token);
    },
    onSuccess: () => {
      if (record) commit(withoutParticipant(record));
      keys.renew();
      setEditing(false);
      refresh();
    },
    onError: reportMutationError,
  });

  const kick = useMutation({
    mutationFn: (id: string) => {
      if (!record?.hostToken) throw new Error("no host token");
      return removeParticipant(roomId, id, record.hostToken);
    },
    onSuccess: refresh,
    onError: reportMutationError,
  });

  const lock = useMutation({
    mutationFn: (locked: boolean) => {
      if (!record?.hostToken) throw new Error("no host token");
      return updateRoom(roomId, record.hostToken, { locked });
    },
    // 방장 토큰으로 받은 방 응답에는 "내 항목" 표시(isSelf)가 없다. 캐시에 넣지 않고 내 토큰으로 다시 불러온다.
    onSuccess: (updated, locked) => {
      // 정한 인원이 차서 잠긴 방은 잠금을 풀어도 서버가 계속 잠김으로 답한다(정원 도달도 locked다).
      if (!locked && updated.locked) setActionError(FULL_LOCK_REASON);
      refresh();
    },
    onError: reportMutationError,
  });

  const remove = useMutation({
    mutationFn: () => {
      if (!record?.hostToken) throw new Error("no host token");
      return deleteRoom(roomId, record.hostToken);
    },
    onSuccess: () => {
      removeRoomRecord(roomId);
      router.push("/");
    },
    onError: reportMutationError,
  });

  const people = useMemo(() => (room ? roomPeople(room) : []), [room]);

  if (record === undefined || (query.isPending && !room)) return <RoomLoading />;
  if (query.isError && !room) {
    if (isRoomGone(query.error)) return <RoomGone />;
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
  const busy = leave.isPending || kick.isPending || lock.isPending || remove.isPending;

  return (
    <RoomShell split="room">
      {/* 왼쪽 칸(폰에서는 위): 소개·링크 보내기·참여자·참여/수정 폼 */}
      <div className={ROOM_SIDE}>
        <RoomIntro title={isHost ? "내가 만든 방" : "함께 정하는 만날 역"} />
        <p className="-mt-3 text-[14px] font-semibold text-ink-soft">{summary(room)}</p>

        {/* 첫 사람(방장)이 방금 만든 방이거나 아직 혼자일 때: 링크 보내기가 가장 먼저 할 일이다. */}
        {joined && !enough ? (
          <section
            aria-labelledby="share-title"
            className="flex flex-col gap-3 rounded-2xl border-2 border-ink bg-surface p-5"
          >
            <h2 id="share-title" className="text-[18px] font-extrabold text-ink">
              친구에게 링크를 보내 주세요
            </h2>
            <p className="text-[14px] text-ink-soft">
              친구가 링크로 들어와 자기 출발역을 넣으면 여기에 나타나요. 두 명 이상 모이면 결과를 볼 수 있어요.
            </p>
            <ShareActions path={roomPath(roomId)} title={SHARE_TITLE} text={SHARE_TEXT} linkType="room" />
          </section>
        ) : null}

        <PeopleList
          people={people}
          maxPeople={MAX_PEOPLE}
          canKick={isHost}
          editing={editing}
          busy={busy}
          onEditSelf={() => {
            setActionError(null);
            edit.reset();
            setEditing(true);
          }}
          onRemoveSelf={() => {
            setActionError(null);
            leave.mutate();
          }}
          onKick={(id) => {
            setActionError(null);
            kick.mutate(id);
          }}
        />
        {actionError && !isHost ? (
          <p role="alert" className="-mt-2 text-sm font-semibold text-destructive">
            {actionError}
          </p>
        ) : null}

        {joined && editing ? (
          <JoinForm
            key="edit"
            mode="edit"
            initial={myValue()}
            personIndex={Math.max(0, selfIndex)}
            pending={edit.isPending}
            timeBasis={room.timeBasis}
            error={edit.isError ? roomErrorMessage(edit.error) : null}
            onSubmit={(input, value) => {
              if (value.station) saveRememberedMe({ code: value.station.code, nickname: value.nickname.trim() });
              edit.mutate(input);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}

        {!joined && state === "can-join" ? (
          <>
            <JoinForm
              key="join"
              mode="join"
              initial={joinValue}
              personIndex={room.participants.length}
              pending={join.isPending}
              timeBasis={room.timeBasis}
              error={join.isError ? roomErrorMessage(join.error) : null}
              onSubmit={(input, value) => {
                if (value.station) saveRememberedMe({ code: value.station.code, nickname: value.nickname.trim() });
                join.mutate(input);
              }}
            />
            {storable ? null : (
              <p role="status" className="-mt-2 text-[13px] text-destructive">
                이 브라우저는 저장 공간을 막아 두어서, 참여한 뒤 이 기기에서 내 항목을 고칠 수 없어요.
              </p>
            )}
          </>
        ) : null}
        {!joined && (state === "full" || state === "locked") ? <CannotJoin reason={state} /> : null}

        {joined && enough ? (
          <section
            aria-labelledby="share-title"
            className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5"
          >
            <h2 id="share-title" className="text-[18px] font-extrabold text-ink">
              링크 다시 보내기
            </h2>
            <ShareActions path={roomPath(roomId)} title={SHARE_TITLE} text={SHARE_TEXT} linkType="room" />
          </section>
        ) : null}
      </div>

      {/* 오른쪽 칸(폰에서는 가운데): 결과 */}
      <div className={ROOM_MAIN}>
        {enough ? (
          <RoomResult
            roomId={roomId}
            room={room}
            participantToken={token}
            participantId={participantId}
            isHost={isHost}
            onResultSeen={() => {
              if (record && !record.resultSeenAt) commit({ ...record, resultSeenAt: new Date().toISOString() });
            }}
            renderAfter={(view) =>
              joined && token && meetingDay ? (
                <OutcomeCard
                  roomId={roomId}
                  participantToken={token}
                  topStationCode={view.candidates[0]?.stationCode ?? ""}
                  resultSeenAt={record?.resultSeenAt}
                  answered={Boolean(record?.outcomeAnswered)}
                  collapsed={!room.meetingDate}
                  onAnswered={() => record && commit({ ...record, outcomeAnswered: true })}
                />
              ) : null
            }
          />
        ) : (
          <section role="status" className="rounded-2xl border border-rule bg-surface p-5 text-[15px] text-ink-soft">
            두 명 이상 들어오면 결과를 볼 수 있어요.
          </section>
        )}
      </div>

      {/* 왼쪽 칸 아래(폰에서는 맨 아래): 방장 설정·만료 안내 */}
      <div className={ROOM_SIDE}>
        {isHost ? (
          <HostControls
            locked={room.locked}
            lockedByCount={fullByCount}
            busy={busy}
            error={actionError}
            onToggleLock={(locked) => {
              setActionError(null);
              lock.mutate(locked);
            }}
            onDeleteRoom={() => {
              setActionError(null);
              remove.mutate();
            }}
          />
        ) : null}

        <p className="text-center text-xs text-muted-foreground">
          방은 마지막 변경 후 7일이 지나거나 만든 지 30일이 지나면 사라져요.
        </p>
      </div>
    </RoomShell>
  );
}
