"use client";

import { ChevronDownIcon, XIcon } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { LineBadges } from "@/components/common/line-badge";
import { SUPPORTED_LINES, unsupportedReason } from "@/lib/stations/coverage";
import {
  BUSAN_LINE_LABELS,
  BUSAN_LINES,
  badgeInk,
  busanLineOf,
  type DraftStation,
  REGION_NAME,
  type Region,
} from "./data";

export type BadgeStyle = "circle" | "pill" | "tagged";

export function Variant({
  id,
  title,
  summary,
  pros,
  cons,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  children: ReactNode;
}) {
  return (
    <article
      aria-labelledby={`${id}-title`}
      className="flex min-w-0 flex-col gap-4 rounded-2xl border border-rule bg-surface p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 id={`${id}-title`} className="text-[17px] font-extrabold text-ink">
          {title}
        </h3>
        <p className="text-[14px] text-ink-soft">{summary}</p>
      </header>
      <div className="rounded-xl border border-dashed border-rule-strong bg-platform p-3">{children}</div>
      <dl className="grid gap-2 text-[13px] leading-snug">
        <div>
          <dt className="font-bold text-ink">좋은 점</dt>
          {pros.map((p) => (
            <dd key={p} className="text-ink-soft">
              · {p}
            </dd>
          ))}
        </div>
        <div>
          <dt className="font-bold text-ink">나쁜 점</dt>
          {cons.map((c) => (
            <dd key={c} className="text-ink-soft">
              · {c}
            </dd>
          ))}
        </div>
      </dl>
    </article>
  );
}

export function Section({
  n,
  title,
  question,
  children,
  note,
}: {
  n: number;
  title: string;
  question: string;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section aria-labelledby={`s${n}`} className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 id={`s${n}`} className="text-[22px] font-extrabold text-ink">
          {n}. {title}
        </h2>
        <p className="text-[15px] text-ink-soft">{question}</p>
        {note ? <div className="text-[13px] text-muted-foreground">{note}</div> : null}
      </header>
      <div className="grid gap-4 lg:grid-cols-3">{children}</div>
    </section>
  );
}

const busanOrder = (label: string) => BUSAN_LINE_LABELS.indexOf(label);

function BusanBadge({ label, style }: { label: string; style: BadgeStyle }) {
  const line = busanLineOf(label);
  if (!line) return null;
  const text = style === "pill" ? line.pill : (line.circle ?? line.pill);
  const round = text.length === 1;
  return (
    <span
      className={
        round
          ? "inline-flex size-5 items-center justify-center rounded-full text-[11px] font-bold"
          : "inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-bold"
      }
      style={{ backgroundColor: line.color, color: badgeInk(line.color) }}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{text}</span>
    </span>
  );
}

function DraftLineBadges({ lines, style }: { lines: readonly string[]; style: BadgeStyle }) {
  const busanLines = lines.filter((l) => busanLineOf(l)).sort((a, b) => busanOrder(a) - busanOrder(b));
  const capitalLines = lines.filter((l) => !busanLineOf(l));
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <LineBadges lines={capitalLines} />
      {busanLines.map((l) => (
        <BusanBadge key={l} label={l} style={style} />
      ))}
    </span>
  );
}

export function RegionTag({ region }: { region: Region }) {
  return (
    <span className="inline-flex h-5 items-center rounded-md border border-rule-strong px-1.5 text-[11px] font-bold text-ink-soft">
      {REGION_NAME[region]}
    </span>
  );
}

export function StationRow({
  station,
  style,
  tag,
  reason,
  onPick,
  extra,
}: {
  station: DraftStation;
  style: BadgeStyle;
  tag: boolean;
  reason?: string | null;
  onPick?: () => void;
  extra?: ReactNode;
}) {
  const why = reason ?? unsupportedReason(station);
  const disabled = why !== null;
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onPick}
        className="flex min-h-11 w-full flex-col items-start rounded-lg px-2 py-1.5 text-left enabled:hover:bg-muted"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className={disabled ? "font-semibold text-muted-foreground" : "font-semibold text-ink"}>
            {station.name}
          </span>
          <DraftLineBadges lines={station.lines} style={style} />
          {tag ? <RegionTag region={station.region} /> : null}
        </span>
        {why ? <span className="text-xs text-muted-foreground">{why}</span> : null}
      </button>
      {extra}
    </li>
  );
}

export function PickedStation({
  label,
  station,
  style,
  onClear,
}: {
  label: string;
  station: DraftStation;
  style: BadgeStyle;
  onClear?: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-bold text-ink-soft">{label}</span>
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-input bg-surface px-3">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink">{station.name}</span>
          <DraftLineBadges lines={station.lines} style={style} />
        </span>
        {onClear ? (
          <button type="button" onClick={onClear} aria-label={`${label} 지우기`} className="p-1 text-muted-foreground">
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function QueryInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-bold text-ink-soft">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="역 이름 입력"
        autoComplete="off"
        className="min-h-11 rounded-lg border border-input bg-surface px-3 text-[16px] text-ink"
      />
    </div>
  );
}

export function ResultList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col rounded-lg border border-rule bg-surface p-1 shadow-sm">{children}</ul>;
}

export function Disclosure({
  summary,
  children,
  defaultOpen = true,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-left text-[15px] font-semibold text-ink-soft underline decoration-rule-strong underline-offset-4"
      >
        {summary}
        <ChevronDownIcon
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} hidden={!open} className="flex flex-col gap-2">
        {children}
      </div>
    </div>
  );
}

export function CapitalLines() {
  return <LineBadges lines={SUPPORTED_LINES} />;
}

export function BusanLines({ style }: { style: BadgeStyle }) {
  return <DraftLineBadges lines={BUSAN_LINES.map((l) => l.label)} style={style} />;
}
