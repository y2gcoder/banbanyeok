"use client";

import { ChevronDownIcon, DicesIcon, EyeOffIcon, RotateCcwIcon, SkipForwardIcon, UserPlusIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { withJosa } from "@/lib/display/korean";
import type { RoomDraw } from "@/lib/room/draw";
import { cn } from "@/lib/utils";
import { seedOf } from "./draw-layout";
import { type DrawPhase, LADDER_PLAY_MS, LadderGame } from "./ladder-game";
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
  /** 방에 출발역을 숨긴 사람이 있다(그 사람에게는 배려 상한이 없다, ADR-0005). */
  hiddenInRoom: boolean;
  /** 이 기기가 방금 이 뽑기를 했다: 카드를 펼치고 그림을 재생한다. 그 밖에는 한 줄로 접어 1위 카드가 첫 화면에 들어오게 한다(#168). */
  justDrew: boolean;
  /** 방장의 뽑기 요청이 서버로 가는 중. */
  pending: boolean;
  /** 마지막 뽑기 요청이 실패한 이유. */
  error: string | null;
  /** 방장이 뽑는다(지금 세대, `round` = 지금 회차 + 1). */
  onDraw: (generation: number, round: number) => void;
  /** 이 뽑기가 화면에 자리 잡았을 때 한 번: 뽑기 전이면 바로, 뽑은 뒤면 결과가 보일 때(재생 중이면 끝난 뒤). */
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

type Focus = "skip" | "heading" | "confirm" | "redraw" | null;

/**
 * '누구 쪽으로' 뽑기 카드(#172). 뽑기 전에는 결과가 '공평하게'로 보이고, 방장만 뽑을 수 있다. 뽑은 결과는 서버에 저장돼 모두에게 같고,
 * 사다리 그림은 그 결과를 재생만 한다(뽑을 때의 대상으로 그려 언제 봐도 같다). 재생은 카드의 타이머가 끝내므로 그림이 없어도 끝난다.
 * 평소에는 한 줄 요약이고, 방장이 막 뽑았을 때만 펼친 채 재생한다. 동작 줄이기면 그림 없이 결과를 보인다.
 * 방 화면이 뽑기(`draw.key`)마다 새로 그린다.
 */
export function FavorDrawCard(props: FavorDrawCardProps) {
  const { draw, viewer, pending } = props;
  const titleId = useId();
  const detailsId = useId();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<DrawPhase>(() =>
    draw.winner === null ? "idle" : props.justDrew && !prefersReducedMotionNow() ? "playing" : "done",
  );
  const [expanded, setExpanded] = useState(props.justDrew);
  // 이 카드에서 그림을 재생했으면 끝난 그림과 결과 문장을 남긴다.
  const [played, setPlayed] = useState(phase === "playing" || props.justDrew);
  const [confirming, setConfirming] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const skip = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const redraw = useRef<HTMLButtonElement>(null);
  // 사라질 버튼에 있던 초점을 어디로 옮길지.
  const [focus, setFocus] = useState<Focus>(props.justDrew ? (phase === "playing" ? "skip" : "heading") : null);

  const finish = () => setPhase("done");

  useEffect(() => {
    if (reduced && phase === "playing") setPhase("done");
  }, [reduced, phase]);

  // 재생은 그림이 아니라 여기서 끝낸다(대상이 한 사람만 남아도, 그림을 그리지 않아도 끝난다).
  useEffect(() => {
    if (phase !== "playing") return;
    const timer = window.setTimeout(() => setPhase("done"), LADDER_PLAY_MS + 250);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase === "playing" && focus === "heading") setFocus("skip");
    if (phase === "done" && focus === "skip") setFocus("heading");
  }, [phase, focus]);

  // 재생이 끝나 건너뛰기 버튼이 사라졌을 때 그 버튼에 있던 초점이 BODY로 빠지지 않게 제목으로 옮긴다.
  const previous = useRef(phase);
  useEffect(() => {
    const wasPlaying = previous.current === "playing";
    previous.current = phase;
    if (
      wasPlaying &&
      phase === "done" &&
      (document.activeElement === null || document.activeElement === document.body)
    ) {
      heading.current?.focus();
    }
  }, [phase]);

  useEffect(() => {
    const target = { skip, heading, confirm, redraw }[focus ?? "heading"];
    if (!focus || !target.current) return;
    target.current.focus();
    setFocus(null);
  }, [focus]);

  const settled = useRef(false);
  const onSettled = useRef(props.onSettled);
  onSettled.current = props.onSettled;
  useEffect(() => {
    if (settled.current || (draw.winner !== null && phase !== "done")) return;
    settled.current = true;
    onSettled.current(draw);
  }, [phase, draw]);

  const winnerName = draw.winner === null ? null : (draw.candidates[draw.winner]?.name ?? null);
  // 결과 문장은 이 화면에서 결과가 나온 그때 한 번 읽힌다: 빈 영역이 먼저 있고, 그 뒤에 채운다.
  useEffect(() => {
    if (phase === "done" && played && winnerName) setAnnouncement(`뽑기 결과, 오늘은 ${winnerName} 쪽으로 맞춰요.`);
  }, [phase, played, winnerName]);

  const redrawsLeft = Math.max(0, draw.maxRounds - draw.round);
  const showGame = phase === "playing" || (phase === "done" && played);
  const enough = draw.candidates.length >= 2;
  const by = draw.round >= 2 ? "방장이 한 번 다시 뽑았어요" : "방장이 뽑았어요";
  const lateEligible = draw.late.filter((p) => !p.hidden).map((p) => p.name);
  const fairness = props.hiddenInRoom
    ? "출발역을 숨긴 사람을 빼면, 다른 사람도 공평 1위보다 15분(또는 그 시간의 절반) 넘게 더 가지 않아요."
    : "다른 사람도 공평 1위보다 15분(또는 그 시간의 절반) 넘게 더 가지 않아요.";
  const title = phase === "playing" ? "뽑는 중…" : winnerName ? `${winnerName} 쪽으로!` : "누구 쪽으로 뽑기 전";

  const drawButton = (compact: boolean) => (
    <Button
      type="button"
      variant={props.full === false ? "outline" : "default"}
      disabled={!enough || pending}
      onClick={() => props.onDraw(draw.generation, draw.round + 1)}
      className={cn(
        compact ? "h-11 px-3.5 text-[15px] font-bold" : "h-13 rounded-xl text-[17px] font-bold",
        props.full === true && enough && "ring-4 ring-safety ring-offset-2 ring-offset-surface",
      )}
    >
      <DicesIcon aria-hidden="true" />
      {pending ? "뽑는 중…" : "사다리 타기"}
    </Button>
  );

  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-surface",
        expanded ? "p-5" : "px-3 py-1",
        phase === "done" && expanded ? "border-2 border-ink" : "border border-rule",
      )}
    >
      <div className="flex items-center gap-2">
        {expanded ? null : <DicesIcon className="size-4 shrink-0 text-ink-soft" aria-hidden="true" />}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {expanded ? (
            <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold text-ink-soft">
              <DicesIcon className="size-4" aria-hidden="true" />
              누구 쪽으로 · 뽑기
              {draw.round >= 2 ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] font-bold text-ink">다시 뽑음</span>
              ) : null}
            </p>
          ) : null}
          <h2
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className={cn(
              "leading-tight font-extrabold text-ink outline-none",
              expanded ? "text-[22px]" : "text-[15px]",
            )}
          >
            {title}
          </h2>
          {!expanded && phase === "done" ? (
            <p className="text-[13px] text-muted-foreground">
              {draw.round >= 2 ? "다시 뽑음 · " : ""}
              {by}
              {draw.drawnAt ? ` · ${clockText(draw.drawnAt)}` : ""}
            </p>
          ) : null}
        </div>
        {!expanded && viewer === "host" && phase === "idle" ? drawButton(true) : null}
        {phase === "playing" ? null : (
          <Button
            type="button"
            variant="ghost"
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={expanded ? "뽑기 접기" : phase === "done" ? "사다리 보기" : "뽑기 자세히 보기"}
            onClick={() => setExpanded((open) => !open)}
            className={cn("h-11 shrink-0 text-[14px] font-semibold", phase === "done" ? "px-2.5" : "w-11 px-0")}
          >
            {phase === "done" ? (expanded ? "접기" : "사다리 보기") : null}
            <ChevronDownIcon aria-hidden="true" className={cn("transition-transform", expanded && "rotate-180")} />
          </Button>
        )}
      </div>

      {/* 결과 문장: 이 화면에서 그림이 끝났을 때(동작 줄이기·건너뛰기면 곧바로) 한 번 읽힌다. */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {expanded ? (
        <div id={detailsId} className="flex flex-col gap-3">
          {phase === "done" && winnerName ? (
            <p className="text-[15px] text-ink-soft">
              {withJosa(winnerName, "이/가")} 덜 이동하는 쪽으로 만날 역을 맞췄어요. {fairness}
            </p>
          ) : phase === "idle" ? (
            <p className="text-[15px] text-ink-soft">
              {viewer === "host"
                ? "뽑힌 사람 쪽으로 만날 역을 맞춰요. 뽑기 전까지는 공평하게로 보여요."
                : "방장이 곧 뽑아요. 뽑기 전까지는 공평하게로 보여요."}
            </p>
          ) : null}

          {(showGame || phase === "done") && enough ? (
            <LadderGame
              people={draw.candidates}
              winner={draw.winner}
              seed={seedOf(`${props.roomId}:${draw.key}`)}
              phase={showGame ? phase : "done"}
            />
          ) : null}

          {phase === "playing" ? (
            <Button
              ref={skip}
              type="button"
              variant="outline"
              onClick={() => {
                setFocus("heading");
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
                {withJosa(draw.hiddenNames.join(", "), "은/는")}{" "}
                {draw.winner === null ? "출발역을 숨겨서" : "뽑을 때 출발역을 숨겨서"} 뽑기에서 빠졌어요. 숨긴 사람 쪽
                결과는 본인만 볼 수 있어서예요.
              </span>
            </p>
          ) : null}

          {draw.late.length > 0 && phase === "done" ? (
            <p className="flex items-start gap-1.5 rounded-xl bg-muted px-3 py-2.5 text-[14px] text-ink-soft">
              <UserPlusIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {viewer === "late"
                  ? "뽑기 뒤에 들어왔어요. 이번 뽑기에는 없었지만 결과는 그대로예요."
                  : `${withJosa(draw.late.map((p) => p.name).join(", "), "이/가")} 뽑기 뒤에 들어왔어요.${
                      viewer === "host" && redrawsLeft > 0 && lateEligible.length > 0
                        ? ` 다시 뽑으면 ${lateEligible.join(", ")}도 함께 들어가요.`
                        : ""
                    }`}
              </span>
            </p>
          ) : null}

          {viewer === "host" && phase === "idle" ? (
            <div className="flex flex-col gap-2">
              {!enough ? (
                <p className="text-[14px] text-ink-soft">
                  출발역을 숨기지 않은 사람이 두 명 이상이어야 뽑을 수 있어요.
                </p>
              ) : props.full === false ? (
                <p className="text-[14px] text-ink-soft">
                  아직 {props.joinedCount}/{props.expectedCount}명이에요. 다 들어온 뒤에 뽑는 게 좋아요.
                </p>
              ) : null}
              {drawButton(false)}
              <p className="text-[13px] leading-snug text-muted-foreground">
                결과는 방 사람 모두에게 똑같이 보이고 새로고침해도 바뀌지 않아요. 다시 뽑기는 한 번만 할 수 있고, 다시
                뽑으면 모두에게 보여요.
              </p>
            </div>
          ) : null}

          {phase === "done" ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
              <p className="mr-auto text-[13px] text-muted-foreground">
                {by}
                {draw.drawnAt ? ` · ${clockText(draw.drawnAt)}` : ""}
              </p>
              {reduced ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setFocus("skip");
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
                      ref={confirm}
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
                      onClick={() => {
                        setConfirming(false);
                        setFocus("redraw");
                      }}
                      className="h-11 px-3 text-[14px]"
                    >
                      취소
                    </Button>
                  </fieldset>
                ) : (
                  <Button
                    ref={redraw}
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setConfirming(true);
                      setFocus("confirm");
                    }}
                    className="h-11 px-3 text-[14px] font-semibold"
                  >
                    {pending ? "뽑는 중…" : `다시 뽑기 (${redrawsLeft}번 남음)`}
                  </Button>
                )
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {props.error ? (
        <p role="alert" className="text-[14px] font-semibold text-destructive">
          {props.error}
        </p>
      ) : null}
    </section>
  );
}
