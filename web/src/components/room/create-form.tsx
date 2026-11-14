"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { warmUpServer } from "@/lib/api/client";
import { createRoom } from "@/lib/api/rooms";
import type { Mode, RoomCreateRequest } from "@/lib/api/types";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { dayAfter, MAX_MEETING_DAYS, todayInSeoul } from "@/lib/room/dates";
import { roomErrorMessage } from "@/lib/room/errors";
import { roomPath } from "@/lib/room/id";
import { type ParticipantFormValue, toCreateRoomRequest } from "@/lib/room/input";
import { canStoreRoomTokens, saveRoomRecord } from "@/lib/room/tokens";
import { stationByCode } from "@/lib/stations";
import { cn } from "@/lib/utils";
import { ParticipantFields } from "./participant-fields";
import { RoomShell } from "./room-states";
import { useIdempotencyKey } from "./use-idempotency-key";
import { slowMessage, useSlowStage } from "./use-slow-hint";

const MODE_OPTIONS: readonly { mode: Mode; title: string; hint: string }[] = [
  { mode: "fair", title: "공평하게", hint: "가장 오래 걸리는 사람의 시간을 줄여요" },
  { mode: "fast", title: "빨리 만나기", hint: "모두의 이동시간 합계가 가장 짧아요" },
  { mode: "favor", title: "내 쪽으로", hint: "오늘은 내가 덜 이동해요. 결과에서 다른 사람 쪽으로도 바꿔 볼 수 있어요" },
];

const COUNTS = [2, 3, 4] as const;

/** 방 만들기(방장). 만들면 방장 토큰·참여자 토큰을 이 기기에 저장하고 방 화면으로 간다. */
export function CreateRoomForm() {
  const router = useRouter();
  const id = useId();
  const keyFor = useIdempotencyKey();
  const [host, setHost] = useState<ParticipantFormValue>({ nickname: "", station: null, hidden: false });
  const [mode, setMode] = useState<Mode>("fair");
  const [meetingDate, setMeetingDate] = useState("");
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [storable, setStorable] = useState(true);
  const [today, setToday] = useState("");

  useEffect(() => {
    // 서버(Cloud Run min 0)를 미리 깨운다. 입력하는 동안 콜드스타트가 끝난다.
    void warmUpServer();
    setToday(todayInSeoul());
    setStorable(canStoreRoomTokens());
    const me = loadRememberedMe();
    const station = me ? stationByCode(me.code) : undefined;
    if (me && station?.supported)
      setHost((current) => (current.station ? current : { ...current, nickname: me.nickname, station }));
  }, []);

  const create = useMutation({
    mutationFn: (body: RoomCreateRequest) => createRoom(body, keyFor(body)),
    onSuccess: (created, body) => {
      saveRoomRecord(created.roomId, {
        hostToken: created.hostToken,
        participantToken: created.participantToken,
        participantId: created.participantId,
        expiresAt: created.expiresAt,
      });
      if (host.station) saveRememberedMe({ code: host.station.code, nickname: host.nickname.trim() });
      track("room_created", {
        hidden_used: body.host.hidden === true,
        ...(body.expectedCount ? { participant_count_expected: body.expectedCount } : {}),
      });
      router.push(roomPath(created.roomId));
    },
  });
  const stage = useSlowStage(create.isPending);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = toCreateRoomRequest({ host, mode, meetingDate, expectedCount }, today || todayInSeoul());
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(null);
    create.mutate(checked.value);
  };

  const submitted = create.isPending || create.isSuccess;
  return (
    <RoomShell>
      <nav>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-md py-1 text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          혼자 입력하기
        </Link>
      </nav>
      <section aria-labelledby={`${id}-title`} className="flex flex-col gap-2">
        <h1 id={`${id}-title`} className="text-[28px] leading-[1.2] font-extrabold tracking-[-0.02em] text-ink">
          친구가 각자 입력하는 방 만들기
        </h1>
        <p className="text-[15px] text-ink-soft">
          내 출발역만 넣고 링크를 보내면, 친구들이 들어와서 자기 출발역을 직접 넣어요. 출발역은 숨길 수도 있어요.
        </p>
      </section>
      <form onSubmit={submit} noValidate className="flex flex-col gap-5">
        <ParticipantFields
          idPrefix={`${id}-host`}
          value={host}
          onChange={(next) => {
            setProblem(null);
            setHost(next);
          }}
          personIndex={0}
          namePlaceholder="내 이름 (선택)"
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[15px] font-bold text-ink">추천 기준</legend>
          {MODE_OPTIONS.map((option) => (
            <label
              key={option.mode}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border bg-surface p-3.5",
                mode === option.mode ? "border-ink ring-1 ring-ink" : "border-rule",
              )}
            >
              <input
                type="radio"
                name={`${id}-mode`}
                value={option.mode}
                checked={mode === option.mode}
                onChange={() => setMode(option.mode)}
                className="mt-1 size-4 shrink-0 accent-[var(--ink)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-bold text-ink">{option.title}</span>
                <span className="text-[13px] leading-snug text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <details className="rounded-xl border border-rule bg-surface p-3.5">
          <summary className="cursor-pointer text-[15px] font-bold text-ink">약속일·인원 정하기 (선택)</summary>
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-date`} className="text-[15px] font-semibold text-ink">
                약속일
              </label>
              <input
                id={`${id}-date`}
                type="date"
                value={meetingDate}
                min={today || undefined}
                max={today ? dayAfter(today, MAX_MEETING_DAYS) : undefined}
                onChange={(e) => {
                  setProblem(null);
                  setMeetingDate(e.target.value);
                }}
                className="h-11 rounded-lg border border-input bg-surface px-3 text-[15px]"
              />
              <p className="text-[13px] text-muted-foreground">
                정하면 약속 다음 날 방이 사라져요. 안 정하면 마지막 변경 후 7일(최대 30일) 뒤에 사라져요.
              </p>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[15px] font-semibold text-ink">예상 인원</legend>
              <div className="flex flex-wrap gap-2">
                {[null, ...COUNTS].map((count) => (
                  <button
                    key={count ?? "none"}
                    type="button"
                    aria-pressed={expectedCount === count}
                    onClick={() => setExpectedCount(count)}
                    className={cn(
                      "h-10 rounded-full border px-4 text-[15px] font-semibold",
                      expectedCount === count
                        ? "border-ink bg-ink text-primary-foreground"
                        : "border-rule-strong bg-surface text-ink",
                    )}
                  >
                    {count === null ? "정하지 않음" : `${count}명`}
                  </button>
                ))}
              </div>
              <p className="text-[13px] text-muted-foreground">
                정한 인원이 다 들어오면 방이 자동으로 닫혀요. 최대 4명이에요.
              </p>
            </fieldset>
          </div>
        </details>
        {storable ? null : (
          <p role="status" className="text-[13px] text-destructive">
            이 브라우저는 저장 공간을 막아 두어서, 만든 뒤에 이 기기에서 방을 관리할 수 없어요. 링크는 그대로 보낼 수
            있어요.
          </p>
        )}
        {problem || create.isError ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {problem ?? roomErrorMessage(create.error)}
          </p>
        ) : null}
        <Button type="submit" disabled={!host.station || submitted} className="h-14 rounded-xl text-[17px] font-bold">
          {submitted ? "방을 만드는 중…" : "방 만들기"}
        </Button>
        {create.isPending && stage > 0 ? (
          <p role="status" className="text-center text-[13px] text-ink-soft">
            {slowMessage(stage, "방 만들기")}
          </p>
        ) : null}
        <p className="text-center text-sm text-muted-foreground">수도권 지하철역만 돼요. 가입은 필요 없어요.</p>
      </form>
    </RoomShell>
  );
}
