"use client";

import { LockIcon, RotateCwIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/common/wordmark";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { slowMessage, useSlowStage } from "./use-slow-hint";

const SHELL = "mx-auto grid min-h-dvh w-full max-w-md content-start gap-5 px-gutter pt-5 pb-10";

/**
 * 두 칸 배치(wide, 640px~). 문서 순서는 폰 순서 그대로 두고 칸만 정한다: 머리(워드마크)와 SIDE 묶음은 왼쪽 칸,
 * MAIN 묶음은 오른쪽 칸 1~3행을 차지한다. 마지막 행이 남는 높이를 받아 왼쪽 항목이 위로 모인다.
 * - room: 왼쪽 = 소개·참여자·참여 폼·방장 설정, 오른쪽 = 결과
 * - form: 왼쪽 = 소개, 오른쪽 = 방 만들기 폼
 */
const SPLIT = {
  room: "hinge-split wide:max-w-6xl wide:grid-cols-2 wide:grid-rows-[auto_auto_1fr] wide:gap-x-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-x-12",
  form: "hinge-split wide:max-w-6xl wide:grid-cols-2 wide:grid-rows-[auto_auto_1fr] wide:gap-x-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-x-16",
} as const;

/** 왼쪽 칸 묶음(머리 아래). */
export const ROOM_SIDE = "flex min-w-0 flex-col gap-5 wide:col-start-1";
/** 오른쪽 칸 묶음. */
export const ROOM_MAIN = "flex min-w-0 flex-col gap-5 wide:col-start-2 wide:row-span-3 wide:row-start-1";

/** 방 화면 공통 틀. 폭·여백은 다른 화면과 같다. `split`이면 두 칸 폭에서 칸을 나눈다. */
export function RoomShell({ children, split }: { children: ReactNode; split?: keyof typeof SPLIT }) {
  return (
    <main className={cn(SHELL, split ? SPLIT[split] : null)}>
      <header className="wide:col-start-1">
        <Wordmark />
      </header>
      {children}
    </main>
  );
}

export function RoomIntro({ title }: { title: string }) {
  return (
    <section aria-labelledby="room-title" className="flex flex-col gap-2">
      <h1 id="room-title" className="text-[26px] leading-[1.2] font-extrabold tracking-[-0.02em] text-ink">
        {title}
      </h1>
      <p className="text-[15px] text-ink-soft">
        각자 출발역을 넣으면 모두에게 공평한 만날 역을 지하철 시간으로 계산해요.
      </p>
    </section>
  );
}

/**
 * 첫 로딩. 콜드스타트로 서버가 3~5초 늦게 답해도 화면이 멈춘 것처럼 보이지 않게, 설명은 먼저 읽히게 두고
 * 단계별 안내 문구를 바꾼다.
 */
export function RoomLoading() {
  const stage = useSlowStage(true);
  return (
    <RoomShell split="room">
      <div className={ROOM_SIDE}>
        <RoomIntro title="함께 정하는 만날 역" />
      </div>
      <div className={ROOM_MAIN}>
        <div role="status" className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5">
          <div className="h-6 w-40 motion-safe:animate-pulse rounded-md bg-muted" />
          <div className="h-3 w-full motion-safe:animate-pulse rounded-full bg-muted" />
          <div className="h-3 w-4/5 motion-safe:animate-pulse rounded-full bg-muted" />
          <p className="text-[15px] text-ink-soft">{slowMessage(stage, "방을 불러오기")}</p>
        </div>
      </div>
    </RoomShell>
  );
}

/** 없는 방·만료된 방·삭제된 방은 서버가 같은 404로 답한다. */
export function RoomGone() {
  return (
    <RoomShell>
      <section role="alert" className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-5">
        <h1 className="text-[22px] font-extrabold text-ink">찾을 수 없는 방이에요</h1>
        <p className="text-[15px] text-ink-soft">
          링크가 잘못됐거나, 방이 만료됐거나, 방장이 지웠어요. 방은 마지막 변경 후 7일이 지나면 사라져요.
        </p>
        <div className="flex flex-col gap-2 pt-1">
          <Link
            href="/r/new"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary text-[16px] font-bold text-primary-foreground"
          >
            새 방 만들기
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-xl text-[15px] font-semibold text-ink-soft"
          >
            혼자 입력해서 찾기
          </Link>
        </div>
      </section>
    </RoomShell>
  );
}

export function RoomLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <RoomShell>
      <section role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-rule bg-surface p-5">
        <p className="text-[15px] text-ink">{message}</p>
        <Button type="button" variant="outline" onClick={onRetry} className="h-11">
          <RotateCwIcon aria-hidden="true" />
          다시 시도
        </Button>
      </section>
    </RoomShell>
  );
}

/** 새로 들어올 수 없는 방(정원 초과·잠김). 목록과 결과는 계속 볼 수 있다. */
export function CannotJoin({ reason }: { reason: "full" | "locked" }) {
  const Icon = reason === "full" ? UsersIcon : LockIcon;
  return (
    <section role="status" className="flex items-start gap-3 rounded-2xl border border-rule bg-surface p-5">
      <Icon className="mt-0.5 size-5 shrink-0 text-ink-soft" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-bold text-ink">
          {reason === "full" ? "방이 가득 찼어요" : "지금은 들어올 수 없는 방이에요"}
        </h2>
        <p className="text-[15px] text-ink-soft">
          {reason === "full"
            ? "한 방에는 최대 4명까지 들어올 수 있어요. 누가 나가면 자리가 생겨요."
            : "방장이 방을 잠갔거나 정해 둔 인원이 다 찼어요. 방장에게 물어보세요."}
        </p>
        <p className="text-[15px] text-ink-soft">대신 혼자 입력해서 따로 찾아볼 수 있어요.</p>
        <Link
          href="/"
          className="mt-1 inline-flex min-h-11 w-fit items-center text-[15px] font-bold text-ink underline underline-offset-4"
        >
          혼자 입력해서 찾기
        </Link>
      </div>
    </section>
  );
}
