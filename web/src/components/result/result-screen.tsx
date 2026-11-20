"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, RotateCwIcon } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useEffect, useId, useMemo, useRef } from "react";
import { Wordmark } from "@/components/common/wordmark";
import { ShareActions } from "@/components/share/share-actions";
import { Button } from "@/components/ui/button";
import { TimeBasisNote } from "@/components/when/time-basis";
import { track, trackLinkOpened, trackResultViewed } from "@/lib/analytics";
import { resultErrorMessage } from "@/lib/api/errors";
import { recommendQueryOptions, takeResponseMillis } from "@/lib/api/queries";
import type { Mode } from "@/lib/api/types";
import { withJosa } from "@/lib/display/korean";
import { restoreHref } from "@/lib/form/prefill";
import { modeFromParam, modeToParam, type ShareState } from "@/lib/link/codec";
import { mapMiddleSentence } from "@/lib/result/map-middle";
import { shareMessage, soloKakaoMessage } from "@/lib/result/share-message";
import { sharePath } from "@/lib/result/share-url";
import { toResultView } from "@/lib/result/view-model";
import { cn } from "@/lib/utils";
import { Candidates, LoadingCard, PANEL, RESULT_GRID, SIDE } from "./parts/candidates";
import type { ChoiceContext } from "./parts/directions";
import { ModeTabs } from "./parts/mode-tabs";
import { Notices } from "./parts/notices";

export type ResultVariant = "creator" | "received";

const searchParsers = { m: parseAsString, me: parseAsInteger };

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
              ? "h-11 rounded-full border border-ink bg-ink px-4 text-[15px] font-semibold text-primary-foreground"
              : "h-11 rounded-full border border-rule-strong bg-surface px-4 text-[15px] font-semibold text-ink"
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
 * 사람 이름은 서버 label·shortLabel만 쓴다. "(나)"는 받은 링크에서 고른 사람에게만 붙인다(만든 사람 화면에는 없다).
 */
export function ResultScreen({
  initial,
  variant,
  initialResponseMs,
}: {
  initial: ShareState;
  variant: ResultVariant;
  /** 서버 컴포넌트가 첫 결과를 미리 받는 데 걸린 시간(밀리초). 통계용. */
  initialResponseMs?: number | undefined;
}) {
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
  const data = query.data;
  // 옛 링크(v=1)는 요일·시간대를 고른 적이 없다: 막차 칸 자체를 보이지 않는다(서버도 시각을 주지 않는다).
  const lastTrains = initial.slotDefaulted !== true;
  const view = useMemo(() => (data ? toResultView(data, { lastTrains }) : null), [data, lastTrains]);
  // 표시 이름은 모드와 무관하므로 모드를 바꾸는 동안 보이는 이전 결과의 이름을 그대로 써도 같다.
  // 첫 결과가 오기 전에는 이름을 모르니 "나는 누구?"와 배려 대상 고르기를 그리지 않는다.
  // 알약(나는 누구?·배려 대상)은 좁은 칸이라 짧은 이름(shortLabel)을 쓴다.
  const people = view?.people.map(({ index, shortName }) => ({ index, name: shortName })) ?? [];

  // 통계: 새 결과가 화면에 나올 때마다(모드를 바꿔 다시 받은 결과 포함) 한 번. 이전 결과를 자리표시로 보여 주는 동안은 세지 않는다.
  const viewedData = useRef<unknown>(null);
  const prefetchedMs = useRef(initialResponseMs);
  const isPlaceholder = query.isPlaceholderData;
  useEffect(() => {
    if (!data || !view || isPlaceholder || viewedData.current === data) return;
    viewedData.current = data;
    const fetchedMs = takeResponseMillis(data) ?? prefetchedMs.current;
    prefetchedMs.current = undefined; // 서버가 미리 받은 시간은 첫 결과에만 해당한다.
    trackResultViewed({
      participantCount: count,
      mode: state.mode,
      topMaxMinutes: view.candidates[0]?.aggregate.max,
      candidateCount: view.candidates.length,
      topStationCode: view.candidates[0]?.stationCode,
      dataVersion: view.dataVersion,
      responseMs: fetchedMs,
    });
  }, [data, view, isPlaceholder, count, state.mode]);

  // 통계: 받은 링크가 열렸다(한 번).
  const linkReported = useRef(false);
  useEffect(() => {
    if (variant !== "received" || linkReported.current) return;
    linkReported.current = true;
    trackLinkOpened("url_state");
  }, [variant]);

  const choice: ChoiceContext = { mode: state.mode, participantCount: count, variant };

  const changeMode = (mode: Mode, favorIndex: number | null) => {
    // 배려 대상을 바꾸는 것(같은 favor 모드 안)은 모드 전환이 아니다.
    if (mode !== state.mode)
      track("mode_switched", { from_mode: state.mode, to_mode: mode, favor_used: mode === "favor" });
    void setSearch({ m: modeToParam(mode, favorIndex, count) });
  };
  const top = view?.candidates[0];
  const longest = top ? top.people.reduce((a, b) => (b.seconds > a.seconds ? b : a)).index : Math.min(1, count - 1);
  const favorName = state.favorIndex === null ? null : (people[state.favorIndex]?.name ?? null);
  const message =
    top && view ? shareMessage(top, state.mode, favorName, data?.timeBasis, mapMiddleSentence(view)) : null;
  const first = view?.people[0];
  const sender = first?.labelKind === "name" ? first.name : null;

  return (
    <main className={RESULT_GRID}>
      {variant === "creator" ? (
        <nav className={SIDE}>
          <Link
            href={restoreHref(state)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-[15px] font-semibold text-ink-soft hover:text-ink"
          >
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            다시 입력
          </Link>
        </nav>
      ) : (
        <header className={cn(SIDE, "flex flex-col gap-3")}>
          <Wordmark />
          <h1 className="text-[24px] leading-tight font-extrabold tracking-[-0.02em] text-ink">
            {sender ? `${withJosa(sender, "이/가")} 고른 만날 역 후보` : "친구가 보낸 만날 역 후보"}
          </h1>
          {people.length > 0 ? (
            <WhoAmI
              people={people}
              meIndex={meIndex}
              onChange={(me) => {
                if (me !== null) track("link_person_selected", { participant_count: count, person_position: me });
                void setSearch({ me });
              }}
            />
          ) : null}
        </header>
      )}

      {variant === "creator" ? <h1 className="sr-only">만날 역 후보</h1> : null}

      <div className={SIDE}>
        <ModeTabs
          mode={state.mode}
          favorIndex={state.favorIndex}
          people={people}
          onChange={changeMode}
          defaultFavorIndex={longest}
          label={variant === "received" ? "기준 바꿔 보기" : "추천 기준"}
          panelId={panelId}
        />
      </div>

      <div id={panelId} role="tabpanel" aria-busy={query.isFetching} className={cn(PANEL, "flex flex-col gap-4")}>
        {view ? (
          <>
            <Notices notices={view.notices} onFavor={(index) => changeMode("favor", index)} />
            <Candidates view={view} meIndex={meIndex} choice={choice} />
          </>
        ) : query.isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-rule bg-surface p-5">
            <p className="text-[15px] text-ink">{resultErrorMessage(query.error)}</p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void query.refetch()} className="h-11">
                <RotateCwIcon aria-hidden="true" />
                다시 시도
              </Button>
              <Link
                href={restoreHref(state)}
                className="inline-flex h-11 items-center rounded-lg px-3 text-[15px] font-semibold text-ink-soft"
              >
                출발역 바꾸기
              </Link>
            </div>
          </div>
        ) : (
          <LoadingCard />
        )}
      </div>

      {view && message ? (
        <div className={SIDE}>
          {variant === "creator" ? (
            <ShareActions
              path={sharePath(state)}
              {...message}
              kakao={soloKakaoMessage(state, message, view.dataVersion)}
            />
          ) : (
            <Link
              href="/"
              className="mt-2 inline-flex h-14 w-full items-center justify-center rounded-xl border-2 border-ink text-[17px] font-bold text-ink wide:mt-0"
            >
              나도 다른 조합으로 찾아보기
            </Link>
          )}
        </div>
      ) : null}
      <TimeBasisNote
        basis={data ? (data.timeBasis ?? null) : undefined}
        requested={state.timeSlot}
        className={cn(SIDE, "text-center wide:text-left")}
      />
    </main>
  );
}
