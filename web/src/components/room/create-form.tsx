"use client";

import { useMutation } from "@tanstack/react-query";
import { DicesIcon, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import { RegionPicker, useRegionChoice } from "@/components/common/region-choice";
import { Button } from "@/components/ui/button";
import { roomHashProperty, track } from "@/lib/analytics";
import { warmUpServer } from "@/lib/api/client";
import { createRoom } from "@/lib/api/rooms";
import type { Mode, RoomCreateRequest } from "@/lib/api/types";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { roomErrorMessage } from "@/lib/room/errors";
import { roomPath } from "@/lib/room/id";
import { type FavorTargetChoice, type ParticipantFormValue, toCreateRoomRequest } from "@/lib/room/input";
import { canStoreRoomTokens, keepUntilFrom, saveRoomRecord } from "@/lib/room/tokens";
import { REGIONS_ENABLED, stationByCode } from "@/lib/stations";
import { blockedReason, type StationScope } from "@/lib/stations/scope";
import { cn } from "@/lib/utils";
import { todayInSeoul } from "@/lib/when/dates";
import { slotForMeeting } from "@/lib/when/time-slot";
import { keepDayAcrossMidnight, type MeetingWhen, MeetingWhenFields, NO_MEETING_WHEN } from "./meeting-when-fields";
import { ParticipantFields } from "./participant-fields";
import { useIdempotencyKey } from "./use-idempotency-key";
import { slowMessage, useSlowStage } from "./use-slow-hint";

const MODE_OPTIONS: readonly { mode: Mode; title: string; hint: string }[] = [
  { mode: "fair", title: "공평하게", hint: "가장 오래 걸리는 사람의 시간을 줄여요" },
  { mode: "fast", title: "빨리 만나기", hint: "모두의 이동시간 합계가 가장 짧아요" },
  { mode: "favor", title: "누구 쪽으로", hint: "" },
];

/** '누구 쪽으로'의 대상(#172). 설명은 고른 대상에 따라 바뀐다. */
const FAVOR_TARGETS: readonly { target: FavorTargetChoice; label: string; hint: string; Icon: typeof UserIcon }[] = [
  {
    target: "host",
    label: "나",
    hint: "오늘은 내가 덜 이동해요. 결과에서 다른 사람 쪽으로도 바꿔 볼 수 있어요",
    Icon: UserIcon,
  },
  {
    target: "draw",
    label: "뽑기로 정하기",
    hint: "누구 쪽으로 할지 뽑기로 정해요. 모두 들어오면 내가 뽑아요",
    Icon: DicesIcon,
  },
];

const COUNTS = [2, 3, 4] as const;

/** 방 만들기(방장). 만들면 방장 토큰·참여자 토큰을 이 기기에 저장하고 방 화면으로 간다. */
export function CreateRoomForm({ className }: { className?: string }) {
  const router = useRouter();
  const id = useId();
  const keys = useIdempotencyKey();
  const [host, setHost] = useState<ParticipantFormValue>({ nickname: "", station: null, hidden: false });
  const [mode, setMode] = useState<Mode>("fair");
  const [favorTarget, setFavorTarget] = useState<FavorTargetChoice>("host");
  const [when, setWhen] = useState<MeetingWhen>(NO_MEETING_WHEN);
  const [expectedCount, setExpectedCount] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [storable, setStorable] = useState(true);
  const [today, setToday] = useState("");
  // 권역(#180): 방의 권역은 방장 출발역의 권역이다. 바꾸면 고른 출발역을 지운다(있으면 먼저 묻는다).
  const regionChoice = useRegionChoice({
    picked: host.station !== null,
    clear: () => setHost((current) => ({ ...current, station: null })),
  });
  const { adopt } = regionChoice;
  // 방이 계산할 구분. 서버와 같은 규칙(contracts/time-slots.json)으로 날짜·시각·시간대에서 정한다.
  const slot = slotForMeeting(when.day?.date ?? null, when.time || null, when.band);
  const scope = useMemo<StationScope>(
    () => (REGIONS_ENABLED ? { region: regionChoice.region, slot } : { region: null, slot: null }),
    [regionChoice.region, slot],
  );

  useEffect(() => {
    // 서버(Cloud Run min 0)를 미리 깨운다. 입력하는 동안 콜드스타트가 끝난다.
    void warmUpServer();
    setToday(todayInSeoul());
    setStorable(canStoreRoomTokens());
    const me = loadRememberedMe();
    const station = me ? stationByCode(me.code) : undefined;
    if (me && station?.supported) {
      adopt(station.region);
      setHost((current) => (current.station ? current : { ...current, nickname: me.nickname, station }));
    }
  }, [adopt]);

  // 화면을 연 채로 자정을 넘길 수 있다. 칩을 누를 때·제출할 때·화면으로 돌아올 때·1분마다 서울 날짜를 다시 읽는다.
  const refreshToday = useCallback((): string => {
    const fresh = todayInSeoul();
    setToday(fresh);
    setWhen((current) => keepDayAcrossMidnight(current, fresh));
    return fresh;
  }, []);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshToday();
    };
    const timer = window.setInterval(refreshToday, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", refreshToday);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", refreshToday);
    };
  }, [refreshToday]);

  const create = useMutation({
    mutationFn: (body: RoomCreateRequest) => createRoom(body, keys.keyFor(body)),
    onSuccess: (created, body) => {
      saveRoomRecord(created.roomId, {
        hostToken: created.hostToken,
        participantToken: created.participantToken,
        participantId: created.participantId,
        keepUntil: keepUntilFrom(),
        ...(body.expectedCount ? { expectedCount: body.expectedCount } : {}),
      });
      keys.renew();
      if (host.station) saveRememberedMe({ code: host.station.code, nickname: host.nickname.trim() });
      track("room_created", {
        hidden_used: body.host.hidden === true,
        ...roomHashProperty({ roomId: created.roomId, roomHash: created.roomHash }),
        ...(body.expectedCount ? { participant_count_expected: body.expectedCount } : {}),
      });
      router.push(roomPath(created.roomId));
    },
  });
  const stage = useSlowStage(create.isPending);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const now = refreshToday();
    const blocked = host.station ? blockedReason(host.station, scope) : null;
    if (blocked) {
      setProblem(`${blocked}. 출발역이나 약속 날짜·시간을 바꿔 주세요.`);
      return;
    }
    const checked = toCreateRoomRequest(
      {
        host,
        mode,
        favorTarget,
        meetingDate: when.day?.date ?? "",
        meetingTime: when.time,
        meetingBand: when.band,
        expectedCount,
      },
      now,
    );
    if (!checked.ok) {
      setProblem(checked.message);
      return;
    }
    setProblem(null);
    create.mutate(checked.value);
  };

  const submitted = create.isPending || create.isSuccess;
  return (
    <form onSubmit={submit} noValidate className={cn("flex min-w-0 flex-col gap-5", className)}>
      <RegionPicker id={`${id}-region`} choice={regionChoice} />
      <ParticipantFields
        idPrefix={`${id}-host`}
        scope={scope}
        onSwitchRegion={regionChoice.request}
        value={host}
        onChange={(patch) => {
          setProblem(null);
          setHost((current) => ({ ...current, ...patch }));
        }}
        personIndex={0}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[15px] font-bold text-ink">추천 기준</legend>
        {MODE_OPTIONS.map((option) => {
          const favor = option.mode === "favor";
          const hint = favor ? (FAVOR_TARGETS.find((t) => t.target === favorTarget)?.hint ?? "") : option.hint;
          return (
            <div
              key={option.mode}
              className={cn(
                "flex flex-col rounded-xl border bg-surface",
                mode === option.mode ? "border-ink ring-1 ring-ink" : "border-rule",
              )}
            >
              <label className="flex cursor-pointer items-start gap-3 p-3.5">
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
                  <span className="text-[13px] leading-snug text-muted-foreground">{hint}</span>
                </span>
              </label>
              {favor && mode === "favor" ? (
                <>
                  <fieldset className="-mt-1 flex flex-wrap gap-2 pr-3.5 pb-3.5 pl-10.5">
                    <legend className="sr-only">누구 쪽으로 할지</legend>
                    {FAVOR_TARGETS.map(({ target, label, Icon }) => (
                      <button
                        key={target}
                        type="button"
                        aria-pressed={favorTarget === target}
                        onClick={() => setFavorTarget(target)}
                        className={cn(
                          "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-semibold",
                          favorTarget === target
                            ? "border-ink bg-ink text-primary-foreground"
                            : "border-rule-strong bg-surface text-ink",
                        )}
                      >
                        <Icon className="size-4" aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                  </fieldset>
                  {favorTarget === "draw" ? (
                    <p className="-mt-1.5 pr-3.5 pb-3.5 pl-10.5 text-[13px] leading-snug text-muted-foreground">
                      뽑기 전까지 결과는 공평하게로 보여요.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>
          );
        })}
      </fieldset>
      <MeetingWhenFields
        id={`${id}-when`}
        today={today}
        value={when}
        onChange={(update) => {
          setProblem(null);
          const fresh = todayInSeoul();
          setToday(fresh);
          setWhen((current) => keepDayAcrossMidnight(update(current), fresh));
        }}
      />
      <details className="rounded-xl border border-rule bg-surface p-3.5">
        <summary className="-my-3 cursor-pointer py-3 text-[15px] font-bold text-ink">인원 정하기 (선택)</summary>
        <div className="mt-3 flex flex-col gap-4">
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
                    "h-11 rounded-full border px-4 text-[15px] font-semibold",
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
      <p className="text-center text-[13px] leading-snug text-muted-foreground">
        약속일을 정하면 약속 다음 날, 안 정하면 마지막 변경 후 7일 뒤에 방이 사라져요(만든 뒤 최대 30일).
      </p>
    </form>
  );
}
