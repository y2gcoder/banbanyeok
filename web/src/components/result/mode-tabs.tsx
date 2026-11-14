"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Mode } from "@/lib/api/types";
import { cn } from "@/lib/utils";

const MODES: readonly Mode[] = ["fair", "fast", "favor"];

export function modeLabel(mode: Mode, favorName: string | null): string {
  switch (mode) {
    case "fair":
      return "공평하게";
    case "fast":
      return "빨리 만나기";
    case "favor":
      return favorName ? `${favorName} 쪽으로` : "누구 쪽으로";
  }
}

type Props = {
  mode: Mode;
  favorIndex: number | null;
  people: readonly { index: number; name: string }[];
  onChange: (mode: Mode, favorIndex: number | null) => void;
  /** 배려 탭을 처음 누를 때 고를 사람(가장 오래 걸리는 사람). */
  defaultFavorIndex: number;
  label: string;
  panelId: string;
};

/** 모드 탭(공평하게 / 빨리 만나기 / ○○ 쪽으로)과, 배려 모드일 때 누구 쪽인지 고르는 줄. */
export function ModeTabs({ mode, favorIndex, people, onChange, defaultFavorIndex, label, panelId }: Props) {
  const favorName = people.find((p) => p.index === favorIndex)?.name ?? null;
  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={mode}
        onValueChange={(value: Mode) => onChange(value, value === "favor" ? (favorIndex ?? defaultFavorIndex) : null)}
      >
        <TabsList aria-label={label} className="grid h-11 w-full grid-cols-3 rounded-xl bg-muted p-1">
          {MODES.map((value) => (
            <TabsTrigger
              key={value}
              value={value}
              aria-controls={panelId}
              className="h-full truncate rounded-lg text-[15px] font-bold text-ink-soft data-active:bg-surface data-active:text-ink data-active:shadow-sm"
            >
              {modeLabel(value, value === "favor" ? favorName : null)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {mode === "favor" ? (
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">누구 쪽으로 기울일까요?</legend>
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            오늘은
          </span>
          {people.map((person) => (
            <button
              key={person.index}
              type="button"
              aria-pressed={favorIndex === person.index}
              onClick={() => onChange("favor", person.index)}
              className={cn(
                "h-9 rounded-full border px-3.5 text-[15px] font-semibold",
                favorIndex === person.index
                  ? "border-ink bg-ink text-primary-foreground"
                  : "border-rule-strong bg-surface text-ink",
              )}
            >
              {person.name}
            </button>
          ))}
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            쪽으로
          </span>
        </fieldset>
      ) : null}
    </div>
  );
}
