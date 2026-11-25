"use client";

import { DicesIcon, EyeOffIcon, RotateCcwIcon, SkipForwardIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { withJosa } from "@/lib/display/korean";
import type { RoomDraw } from "@/lib/room/draw";
import { cn } from "@/lib/utils";
import { seedOf } from "./draw-layout";
import { type DrawPhase, LadderGame } from "./ladder-game";
import { prefersReducedMotionNow, useReducedMotion } from "./use-reduced-motion";

export type FavorDrawCardProps = {
  roomId: string;
  draw: RoomDraw;
  /** 이 화면을 보는 사람: 방장, 그 밖의 사람(참가자·보기만 하는 사람), 뽑은 뒤 들어온 참가자. */
  viewer: "host" | "member" | "late";
  /** 예정 인원이 다 찼는지(방장 버튼 강조). null이면 예정 인원을 모른다. */
  full: boolean | null;
  joinedCount: number;
  expectedCount: number | null;
  /** 이 기기에서 이번 뽑기 그림을 이미 봤는지. 처음 보는 사람에게는 한 번 재생한다. */
  seen: boolean;
  /** 이 기기가 방금 뽑았다(그림이 시작되면 건너뛰기 버튼으로 초점을 옮긴다). */
  justDrew: boolean;
  /** 방장의 뽑기 요청이 서버로 가는 중. */
  pending: boolean;
  /** 마지막 뽑기 요청이 실패한 이유. */
  error: string | null;
  /** 방장이 뽑는다(지금 세대, `round` = 지금 회차 + 1). */
  onDraw: (generation: number, round: number) => void;
  /** 이 뽑기가 화면에 자리 잡았을 때 한 번: 뽑기 전이면 바로, 뽑은 뒤면 그림이 끝났을 때(동작 줄이기·건너뛰기면 곧바로). */
  onSettled: (draw: RoomDraw) => void;
};

/** 뽑은 시각 "20:14"(서울). */
function clockText(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/**
 * '누구 쪽으로' 뽑기 카드(#172). 뽑기 전에는 결과가 '공평하게'로 보이고, 방장만 뽑을 수 있다. 뽑은 결과는 서버에 저장돼 모두에게 같고,
 * 사다리 그림은 그 결과를 재생만 한다. 동작 줄이기면 그림 없이 결과를 보이고, 결과 문장은 aria-live로 한 번 읽힌다.
 * 방 화면이 뽑기(`draw.key`)마다 새로 그린다.
 */
export function FavorDrawCard(props: FavorDrawCardProps) {
  const { draw, viewer, pending } = props;
  const titleId = useId();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<DrawPhase>(() =>
    draw.winner === null ? "idle" : props.seen || prefersReducedMotionNow() ? "done" : "playing",
  );
  // 이 화면에서 그림을 재생했으면 끝난 그림을 남기고, 이미 본 결과는 접어 둔다(폰 첫 화면에 1위 카드가 들어오게, #168).
  const [played, setPlayed] = useState(phase === "playing");
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  // 사라질 버튼에 있던 초점을 어디로 옮길지(그림 시작 → 건너뛰기, 그림 끝 → 카드 제목).
  const moveFocus = useRef(props.justDrew);

  useEffect(() => {
    if (reduced && phase === "playing") setPhase("done");
  }, [reduced, phase]);

  useEffect(() => {
    if (!moveFocus.current) return;
    if (phase === "playing") skip.current?.focus();
    if (phase === "done") {
      heading.current?.focus();
      moveFocus.current = false;
    }
  }, [phase]);

  const settled = useRef(false);
  const onSettled = useRef(props.onSettled);
  onSettled.current = props.onSettled;
  useEffect(() => {
    if (settled.current || (draw.winner !== null && phase !== "done")) return;
    settled.current = true;
    onSettled.current(draw);
  }, [phase, draw]);

  const finish = () => setPhase("done");
  const winnerName = draw.winner === null ? null : (draw.candidates[draw.winner]?.name ?? null);
  const redrawsLeft = Math.max(0, draw.maxRounds - draw.round);
  const showGame = phase !== "done" || played;
  const enough = draw.candidates.length >= 2;

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-surface p-5",
        phase === "done" ? "border-2 border-ink" : "border border-rule",
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-ink-soft">
          <DicesIcon className="size-4" aria-hidden="true" />
          누구 쪽으로 · 사다리타기
          {draw.round >= 2 ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-bold text-ink">다시 뽑음</span>
          ) : null}
        </p>
        <h2
          id={titleId}
          ref={heading}
          tabIndex={-1}
          className="text-[22px] leading-tight font-extrabold text-ink outline-none"
        >
          {phase === "done" && winnerName
            ? `${winnerName} 쪽으로!`
            : phase === "playing"
              ? "뽑는 중…"
              : "누구 쪽으로 할지 뽑아요"}
        </h2>
      </div>

      {phase === "done" && winnerName ? (
        <p className="text-[15px] text-ink-soft">
          {withJosa(winnerName, "이/가")} 덜 이동하는 쪽으로 만날 역을 맞췄어요. 다른 사람도 공평 1위보다 15분(또는 그
          시간의 절반) 넘게 더 가지 않아요.
        </p>
      ) : phase === "idle" ? (
        <p className="text-[15px] text-ink-soft">
          {viewer === "host"
            ? "뽑힌 사람 쪽으로 만날 역을 맞춰요. 뽑기 전까지는 공평하게로 보여요."
            : "방장이 곧 뽑아요. 뽑기 전까지는 공평하게로 보여요."}
        </p>
      ) : null}

      {showGame && enough ? (
        <LadderGame
          people={draw.candidates}
          winner={phase === "idle" ? null : draw.winner}
          seed={seedOf(`${props.roomId}:${draw.key}`)}
          phase={phase}
          onDone={finish}
        />
      ) : null}

      {/* 결과 문장: 그림이 끝났을 때(동작 줄이기·건너뛰기면 곧바로) 한 번 읽힌다. */}
      <p aria-live="polite" className="sr-only">
        {phase === "done" && winnerName ? `뽑기 결과, 오늘은 ${winnerName} 쪽으로 맞춰요.` : ""}
      </p>

      {phase === "playing" ? (
        <Button
          ref={skip}
          type="button"
          variant="outline"
          onClick={() => {
            moveFocus.current = true;
            finish();
          }}
          className="h-11 self-center px-4 text-[15px] font-semibold"
        >
          <SkipForwardIcon aria-hidden="true" />
          건너뛰고 결과 보기
        </Button>
      ) : null}

      {draw.hiddenNames.length > 0 ? (
        <p className="flex items-start gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-[14px] text-ink-soft">
          <EyeOffIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {withJosa(draw.hiddenNames.join(", "), "은/는")} 출발역을 숨겨서 뽑기에서 빠졌어요. 숨긴 사람 쪽 결과는
            본인만 볼 수 있어서예요.
          </span>
        </p>
      ) : null}

      {draw.lateNames.length > 0 && phase === "done" ? (
        <p className="flex items-start gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-[14px] text-ink-soft">
          <UserPlusIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {viewer === "late"
              ? "뽑기 뒤에 들어왔어요. 이번 뽑기에는 없었지만 결과는 그대로예요."
              : `${withJosa(draw.lateNames.join(", "), "이/가")} 뽑기 뒤에 들어왔어요.${viewer === "host" && redrawsLeft > 0 ? " 다시 뽑으면 함께 들어가요." : ""}`}
          </span>
        </p>
      ) : null}

      {viewer === "host" && phase === "idle" ? (
        <div className="flex flex-col gap-2">
          {!enough ? (
            <p className="text-[14px] text-ink-soft">출발역을 숨기지 않은 사람이 두 명 이상이어야 뽑을 수 있어요.</p>
          ) : props.full === false ? (
            <p className="text-[14px] text-ink-soft">
              아직 {props.joinedCount}/{props.expectedCount}명이에요. 다 들어온 뒤에 뽑는 게 좋아요.
            </p>
          ) : null}
          <Button
            type="button"
            variant={props.full === false ? "outline" : "default"}
            disabled={!enough || pending}
            onClick={() => props.onDraw(draw.generation, draw.round + 1)}
            className={cn(
              "h-13 rounded-xl text-[17px] font-bold",
              props.full === true && enough && "ring-4 ring-safety ring-offset-2 ring-offset-surface",
            )}
          >
            <DicesIcon aria-hidden="true" />
            {pending ? "뽑는 중…" : "사다리 타기"}
          </Button>
          <p className="text-[13px] leading-snug text-muted-foreground">
            결과는 방 사람 모두에게 똑같이 보이고 새로고침해도 바뀌지 않아요. 다시 뽑기는 한 번만 할 수 있고, 다시
            뽑으면 모두에게 보여요.
          </p>
        </div>
      ) : null}

      {props.error ? (
        <p role="alert" className="text-[14px] font-semibold text-destructive">
          {props.error}
        </p>
      ) : null}

      {phase === "done" ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
          <p className="mr-auto text-[13px] text-muted-foreground">
            {draw.round >= 2 ? "방장이 한 번 다시 뽑았어요" : "방장이 뽑았어요"}
            {draw.drawnAt ? ` · ${clockText(draw.drawnAt)}` : ""}
          </p>
          {reduced ? null : (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                moveFocus.current = true;
                setPlayed(true);
                setPhase("playing");
              }}
              className="h-11 px-3 text-[14px] font-semibold"
            >
              <RotateCcwIcon aria-hidden="true" />
              다시 보기
            </Button>
          )}
          {viewer === "host" && redrawsLeft > 0 ? (
            confirming ? (
              <fieldset className="flex min-w-0 flex-wrap items-center gap-2">
                <legend className="sr-only">다시 뽑기 확인</legend>
                <span className="text-[14px] text-ink">다시 뽑으면 모두에게 보여요. 다시 뽑을까요?</span>
                <Button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    setConfirming(false);
                    props.onDraw(draw.generation, draw.round + 1);
                  }}
                  className="h-11 px-3 text-[14px] font-bold"
                >
                  다시 뽑기
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setConfirming(false)}
                  className="h-11 px-3 text-[14px]"
                >
                  취소
                </Button>
              </fieldset>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setConfirming(true)}
                className="h-11 px-3 text-[14px] font-semibold"
              >
                {pending ? "뽑는 중…" : `다시 뽑기 (${redrawsLeft}번 남음)`}
              </Button>
            )
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
