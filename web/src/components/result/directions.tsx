"use client";

import { ChevronDownIcon, MapIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { track } from "@/lib/analytics";
import type { CandidateView } from "@/lib/result/view-model";
import { cn } from "@/lib/utils";

const linkButton = cn(buttonVariants({ variant: "outline" }), "h-11 flex-1 rounded-lg text-[15px] font-semibold");

/** 지도에서 보기 + 사람별 카카오맵 길찾기. 웹 링크가 기본(앱 스킴은 공식 문서가 없어 쓰지 않는다). */
export function Directions({ candidate, meIndex = null }: { candidate: CandidateView; meIndex?: number | null }) {
  const opened = () => track("map_app_opened", { app: "kakao", rank: candidate.rank });
  const routes = candidate.people.filter((p) => p.directionsUrl);
  const mine = meIndex === null ? undefined : routes.find((p) => p.index === meIndex);
  return (
    <div className="flex gap-2">
      {candidate.placeUrl ? (
        <a href={candidate.placeUrl} target="_blank" rel="noopener noreferrer" onClick={opened} className={linkButton}>
          <MapIcon aria-hidden="true" />
          지도에서 보기
        </a>
      ) : null}
      {mine?.directionsUrl ? (
        <a href={mine.directionsUrl} target="_blank" rel="noopener noreferrer" onClick={opened} className={linkButton}>
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
            <ul>
              {routes.map((p) => (
                <li key={p.index}>
                  <a
                    href={p.directionsUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={opened}
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
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
