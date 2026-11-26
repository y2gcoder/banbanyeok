"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_REGION, REGIONS_ENABLED, type RegionId, regionName } from "@/lib/stations";
import { REGION_CHOICES } from "@/lib/stations/scope";
import { cn } from "@/lib/utils";

type RegionState = readonly [RegionId, (region: RegionId) => void];

const RegionContext = createContext<RegionState | null>(null);

/**
 * 첫 화면에서 고른 권역을 입력 카드와 계산 범위 한 줄이 같이 본다. 고르는 곳은 입력 카드다(useRegionChoice).
 * 방 만들기처럼 범위 한 줄이 없는 화면은 감싸지 않아도 된다(useRegionChoice가 제 상태를 쓴다).
 */
export function RegionProvider({ children }: { children: ReactNode }) {
  const [region, setRegion] = useState<RegionId>(DEFAULT_REGION);
  return <RegionContext value={[region, setRegion]}>{children}</RegionContext>;
}

/** 지금 고른 권역(감싼 RegionProvider가 없으면 기본 권역). */
export function useChosenRegion(): RegionId {
  return useContext(RegionContext)?.[0] ?? DEFAULT_REGION;
}

/** 권역 바꾸기: 고른 출발역이 없으면 바로, 있으면 지우기 전에 한 번 묻는다(`asking`). */
export type RegionChoice = {
  region: RegionId;
  /** 확인을 기다리는 바꿀 권역. */
  asking: RegionId | null;
  request: (next: RegionId) => void;
  confirm: () => void;
  cancel: () => void;
  /** 묻지 않고 바꾼다(미리 채운 역·기억해 둔 "나"의 권역에 맞출 때). 렌더마다 같은 함수다. */
  adopt: (region: RegionId) => void;
};

export function useRegionChoice({ picked, clear }: { picked: boolean; clear: () => void }): RegionChoice {
  const shared = useContext(RegionContext);
  const own = useState<RegionId>(DEFAULT_REGION);
  const [region, setRegion] = shared ?? own;
  const [asking, setAsking] = useState<RegionId | null>(null);
  const adopt = useCallback(
    (next: RegionId) => {
      setRegion(next);
      setAsking(null);
    },
    [setRegion],
  );
  const switchTo = (next: RegionId) => {
    clear();
    setRegion(next);
    setAsking(null);
  };
  return {
    region,
    asking,
    request: (next) => {
      if (next === region) return setAsking(null);
      if (picked) return setAsking(next);
      switchTo(next);
    },
    confirm: () => {
      if (asking !== null) switchTo(asking);
    },
    cancel: () => setAsking(null),
    adopt,
  };
}

/**
 * "어디서 만나요? 수도권 | 부산권"(#180). 권역이 하나뿐인 데이터에서는 그리지 않는다. 고른 출발역이 있는데 바꾸려 하면 그 자리에서
 * 지워도 되는지 묻는다(역 칸의 "부산권으로 바꾸기"도 같은 질문으로 온다).
 */
export function RegionPicker({ id, choice }: { id: string; choice: RegionChoice }) {
  const questionRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (choice.asking === null) return;
    questionRef.current?.scrollIntoView?.({ block: "nearest" });
    questionRef.current?.focus();
  }, [choice.asking]);
  if (!REGIONS_ENABLED) return null;
  return (
    <fieldset className="flex flex-col gap-2">
      <legend id={`${id}-legend`} className="mb-1 text-[15px] font-bold text-ink">
        어디서 만나요?
      </legend>
      <div className="flex flex-wrap gap-2">
        {REGION_CHOICES.map(({ id: region, name }) => (
          <button
            key={region}
            type="button"
            aria-pressed={choice.region === region}
            onClick={() => choice.request(region)}
            className={cn(
              "h-11 rounded-full border px-4 text-[15px] font-semibold",
              choice.region === region
                ? "border-ink bg-ink text-primary-foreground"
                : "border-rule-strong bg-surface text-ink",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      {choice.asking !== null ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rule-strong bg-surface p-3">
          <p ref={questionRef} tabIndex={-1} className="text-[14px] text-ink">
            고른 출발역을 지우고 {regionName(choice.asking)}으로 바꿀까요?
          </p>
          <Button type="button" onClick={choice.confirm} className="h-11 px-3 text-[14px] font-bold">
            바꾸기
          </Button>
          <Button type="button" variant="ghost" onClick={choice.cancel} className="h-11 px-3 text-[14px]">
            취소
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}
