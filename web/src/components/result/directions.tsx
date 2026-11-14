"use client";

import { CheckIcon, ChevronDownIcon, MapIcon } from "lucide-react";
import { useRef, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { track } from "@/lib/analytics";
import type { Mode } from "@/lib/api/types";
import type { CandidateView, PersonTimeView } from "@/lib/result/view-model";
import { cn } from "@/lib/utils";

const linkButton = cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 rounded-lg text-[15px] font-semibold");
const chooseButton = cn(buttonVariants(), "h-12 w-full rounded-xl text-[16px] font-bold");

/** "이 역으로 정했어요" 이벤트에 필요한 화면 맥락(모드·인원·누가 보는 화면인지). 출발역·이름은 담지 않는다. */
export type ChoiceContext = {
  mode: Mode;
  participantCount: number;
  variant: "creator" | "received";
};

type Route = PersonTimeView & { directionsUrl: string };

function RouteLinks({ routes, candidate, onOpen }: { routes: Route[]; candidate: CandidateView; onOpen: () => void }) {
  return (
    <ul>
      {routes.map((p) => (
        <li key={p.index}>
          <a
            href={p.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpen}
            className="flex flex-col rounded-md px-2 py-2 hover:bg-accent"
          >
            <span className="text-[15px] font-semibold text-ink">{p.name}</span>
            <span className="text-[13px] text-muted-foreground">
              {p.originName} → {candidate.stationName}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * 지도에서 보기 + 사람별 카카오맵 길찾기 + "이 역으로 정했어요". 웹 링크가 기본(앱 스킴은 공식 문서가 없어 쓰지 않는다).
 *
 * "이 역으로 정했어요"는 실제로 만날 역을 정했는지의 대리 지표다. 누르면 길찾기로 이어진다:
 * 받은 링크에서 "나"를 골랐다면 내 길찾기를 바로 열고, 아니면 사람별 길찾기를 고르는 목록을 연다.
 * 길찾기를 열 수 없는 카드(출발역을 숨긴 경우 등)는 눌렀다는 표시만 한다. 한 카드에서 여러 번 눌러도 한 번만 센다.
 */
export function Directions({
  candidate,
  choice,
  meIndex = null,
}: {
  candidate: CandidateView;
  choice: ChoiceContext;
  meIndex?: number | null;
}) {
  const [chosen, setChosen] = useState(false);
  const [open, setOpen] = useState(false);
  const counted = useRef(false);
  const opened = () => track("map_app_opened", { app: "kakao", rank: candidate.rank });
  const routes = candidate.people.filter((p): p is Route => p.directionsUrl !== null);
  const mine = meIndex === null ? undefined : routes.find((p) => p.index === meIndex);

  const choose = () => {
    setChosen(true);
    if (counted.current) return;
    counted.current = true;
    track("station_chosen", {
      rank: candidate.rank,
      meeting_station_code: candidate.stationCode,
      mode: choice.mode,
      participant_count: choice.participantCount,
      link_variant: choice.variant,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {mine ? (
        <a
          href={mine.directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            choose();
            opened();
          }}
          className={chooseButton}
        >
          <CheckIcon aria-hidden="true" />이 역으로 정했어요
        </a>
      ) : routes.length > 0 ? (
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) choose();
          }}
        >
          <PopoverTrigger className={chooseButton}>
            <CheckIcon aria-hidden="true" />이 역으로 정했어요
          </PopoverTrigger>
          <PopoverContent align="center" className="w-72 p-1.5">
            <p className="px-2 pt-1 pb-1.5 text-sm font-semibold text-ink">정했어요! 각자 길찾기로 이어가요</p>
            <RouteLinks routes={routes} candidate={candidate} onOpen={opened} />
          </PopoverContent>
        </Popover>
      ) : (
        <button
          type="button"
          onClick={choose}
          aria-pressed={chosen}
          className={cn(chooseButton, chosen && "bg-ink/80")}
        >
          <CheckIcon aria-hidden="true" />
          {chosen ? "정했어요!" : "이 역으로 정했어요"}
        </button>
      )}
      {routes.length > 0 ? (
        <p className="text-center text-[13px] text-muted-foreground">
          {mine ? "누르면 카카오맵 길찾기가 열려요." : "누르면 카카오맵 길찾기를 고를 수 있어요."}
        </p>
      ) : null}
      <div className="flex gap-2">
        {candidate.placeUrl ? (
          <a
            href={candidate.placeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={opened}
            className={linkButton}
          >
            <MapIcon aria-hidden="true" />
            지도에서 보기
          </a>
        ) : null}
        {mine ? (
          <a
            href={mine.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={opened}
            className={linkButton}
          >
            내 길찾기
          </a>
        ) : routes.length > 0 ? (
          <Popover>
            <PopoverTrigger className={linkButton}>
              길찾기
              <ChevronDownIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-1.5">
              <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">카카오맵 대중교통 길찾기</p>
              <RouteLinks routes={routes} candidate={candidate} onOpen={opened} />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}
