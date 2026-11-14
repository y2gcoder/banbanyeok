"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useEffect, useId, useState } from "react";
import { Wordmark } from "@/components/common/wordmark";
import { ShareActions } from "@/components/share/share-actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { ApiRequestError } from "@/lib/api/client";
import { recommendQueryOptions } from "@/lib/api/queries";
import type { Mode } from "@/lib/api/types";
import { withJosa } from "@/lib/display/korean";
import { modeFromParam, modeToParam, type ShareState } from "@/lib/link/codec";
import { shareMessage } from "@/lib/result/share-message";
import { sharePath } from "@/lib/result/share-url";
import { type ResultView, toResultView } from "@/lib/result/view-model";
import { OtherCandidateRow, TopCandidateCard } from "./candidate-card";
import { ModeTabs, modeLabel } from "./mode-tabs";
import { Notices } from "./notices";

export type ResultVariant = "creator" | "received";

const searchParsers = { m: parseAsString, me: parseAsInteger };

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return error.message;
  return "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export function LoadingCard() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 2500);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div role="status" className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-5">
      <div className="h-8 w-32 motion-safe:animate-pulse rounded-md bg-muted" />
      <div className="h-3 w-full motion-safe:animate-pulse rounded-full bg-muted" />
      <div className="h-3 w-4/5 motion-safe:animate-pulse rounded-full bg-muted" />
      <p className="text-[15px] text-ink-soft">
        {slow ? "서버를 깨우는 중이에요. 몇 초만 기다려 주세요." : "만날 역을 고르는 중이에요."}
      </p>
    </div>
  );
}

function Candidates({ view, meIndex }: { view: ResultView; meIndex: number | null }) {
  const [top, ...rest] = view.candidates;
  if (!top) return null;
  return (
    <>
      <TopCandidateCard candidate={top} meIndex={meIndex} />
      {rest.length > 0 ? (
        <section aria-label="다른 후보" className="overflow-hidden rounded-2xl border border-rule bg-surface">
          {rest.map((candidate) => (
            <OtherCandidateRow key={candidate.stationCode} candidate={candidate} meIndex={meIndex} />
          ))}
        </section>
      ) : null}
    </>
  );
}

function WhoAmI({
  people,
  meIndex,
  onChange,
}: {
  people: readonly { index: number; name: string }[];
  meIndex: number | null;
  onChange: (i: number | null) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="mb-2 text-[15px] font-bold text-ink">나는 누구?</legend>
      {people.map(({ index, name }) => (
        <button
          key={index}
          type="button"
          aria-pressed={meIndex === index}
          onClick={() => onChange(meIndex === index ? null : index)}
          className={
            meIndex === index
              ? "h-10 rounded-full border border-ink bg-ink px-4 text-[15px] font-semibold text-primary-foreground"
              : "h-10 rounded-full border border-rule-strong bg-surface px-4 text-[15px] font-semibold text-ink"
          }
        >
          {name}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * 결과(화면 2)와 받은 링크(화면 4). 모드·"나는 누구?"는 URL 상태(nuqs)이고 결과는 서버가 계산한다.
 * 사람 이름은 서버 label만 쓴다. "(나)"는 받은 링크에서 고른 사람에게만 붙인다(만든 사람 화면에는 없다).
 */
export function ResultScreen({ initial, variant }: { initial: ShareState; variant: ResultVariant }) {
  const panelId = useId();
  const [search, setSearch] = useQueryStates(searchParsers, { history: "replace", shallow: true, scroll: false });
  const count = initial.origins.length;
  const current = (search.m ? modeFromParam(search.m, count) : null) ?? {
    mode: initial.mode,
    favorIndex: initial.favorIndex,
  };
  const state: ShareState = { ...initial, ...current };
  const meIndex =
    variant === "received" && search.me !== null && search.me >= 0 && search.me < count ? search.me : null;
  const query = useQuery({ ...recommendQueryOptions(state), placeholderData: (previous) => previous });
  const view = query.data ? toResultView(query.data) : null;
  // 표시 이름은 모드와 무관하므로 모드를 바꾸는 동안 보이는 이전 결과의 이름을 그대로 써도 같다.
  // 첫 결과가 오기 전에는 이름을 모르니 "나는 누구?"와 배려 대상 고르기를 그리지 않는다.
  const people = view?.people.map(({ index, name }) => ({ index, name })) ?? [];

  const changeMode = (mode: Mode, favorIndex: number | null) => {
    track("mode_switched", { from_mode: state.mode, to_mode: mode, favor_used: mode === "favor" });
    void setSearch({ m: modeToParam(mode, favorIndex, count) });
  };
  const top = view?.candidates[0];
  const longest = top ? top.people.reduce((a, b) => (b.seconds > a.seconds ? b : a)).index : Math.min(1, count - 1);
  const favorName = state.favorIndex === null ? null : (people[state.favorIndex]?.name ?? null);
  const first = view?.people[0];
  const sender = first?.labelKind === "name" ? first.name : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pt-4 pb-10">
      {variant === "creator" ? (
        <nav>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md py-1 text-[15px] font-semibold text-ink-soft hover:text-ink"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            다시 입력
          </Link>
        </nav>
      ) : (
        <header className="flex flex-col gap-3">
          <Wordmark />
          <h1 className="text-[24px] leading-tight font-extrabold tracking-[-0.02em] text-ink">
            {sender ? `${withJosa(sender, "이/가")} 고른 만날 역 후보` : "친구가 보낸 만날 역 후보"}
          </h1>
          {people.length > 0 ? (
            <WhoAmI people={people} meIndex={meIndex} onChange={(me) => void setSearch({ me })} />
          ) : null}
        </header>
      )}

      {variant === "creator" ? <h1 className="sr-only">만날 역 후보</h1> : null}

      <ModeTabs
        mode={state.mode}
        favorIndex={state.favorIndex}
        people={people}
        onChange={changeMode}
        defaultFavorIndex={longest}
        label={variant === "received" ? "기준 바꿔 보기" : "추천 기준"}
        panelId={panelId}
      />

      <div id={panelId} role="tabpanel" aria-busy={query.isFetching} className="flex flex-col gap-4">
        {view ? (
          <>
            <Notices notices={view.notices} onFavor={(index) => changeMode("favor", index)} />
            <Candidates view={view} meIndex={meIndex} />
          </>
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-rule bg-surface p-5">
            <p className="text-[15px] text-ink">{errorMessage(query.error)}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void query.refetch()} className="h-10">
                <RotateCwIcon aria-hidden="true" />
                다시 시도
              </Button>
              <Link
                href="/"
                className="inline-flex h-10 items-center rounded-lg px-3 text-[15px] font-semibold text-ink-soft"
              >
                출발역 바꾸기
              </Link>
            </div>
          </div>
        ) : (
          <LoadingCard />
        )}
      </div>

      {view && top ? (
        variant === "creator" ? (
          <ShareActions path={sharePath(state)} {...shareMessage(top, modeLabel(state.mode, favorName))} />
        ) : (
          <Link
            href="/"
            className="mt-2 inline-flex h-14 items-center justify-center rounded-xl border-2 border-ink text-[17px] font-bold text-ink"
          >
            나도 다른 조합으로 찾아보기
          </Link>
        )
      ) : null}
      <p className="text-center text-xs text-muted-foreground">역에서 역까지, 평일 낮 기준 시간이에요.</p>
    </main>
  );
}
