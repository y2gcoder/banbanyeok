"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineBadges } from "@/components/common/line-badge";
import { NoStationMatch } from "@/components/common/supported-lines";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { withJosa } from "@/lib/display/korean";
import { DEFAULT_REGION, type RegionId, regionName, type Station } from "@/lib/stations";
import {
  blockedReason,
  type Elsewhere,
  elsewhere,
  OPEN_SCOPE,
  type StationScope,
  searchInScope,
} from "@/lib/stations/scope";

type Props = {
  id: string;
  value: Station | null;
  onChange: (station: Station | null) => void;
  describedBy?: string;
  /** 고를 수 있는 범위(권역·구분, lib/stations/scope.ts). 없으면 모든 역. */
  scope?: StationScope;
  /** 다른 권역에만 있는 역을 쳤을 때 "○○권으로 바꾸기"를 누르면 부른다. 없으면(방 참여) 바꾸기 버튼이 없다. */
  onSwitchRegion?: (region: RegionId) => void;
  /** 첫 수화에서 브라우저가 이미 받은 검색어가 있으면 호출한다. */
  onInitialSearch?: () => void;
};

/**
 * 역 자동완성. 초성("ㅎㄷ")·생략형("홍대")·"역" 접미사를 받는다. 계산하지 않는 역과 그 구분에 출발할 수 없는 역은 보이되 고를 수 없고
 * 이유가 붙는다(lib/stations/scope.ts). 결과가 없으면 계산 범위를 알리고, 다른 권역에 있는 이름이면 그 권역을 한 줄로 알린다
 * (목록이 있어도 다른 권역에만 정확히 같은 이름이 있으면 목록 아래에).
 */
export function StationField({
  id,
  value,
  onChange,
  describedBy,
  scope = OPEN_SCOPE,
  onSwitchRegion,
  onInitialSearch,
}: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const inputAttached = useRef(false);
  // 수화가 입력에 제어값을 다시 쓰기 전에 사용자가 브라우저에 입력한 글을 상태로 옮긴다.
  const readInitialInput = useCallback(
    (input: HTMLInputElement | null) => {
      if (!input || !onInitialSearch || inputAttached.current) return;
      inputAttached.current = true;
      if (input.value === input.defaultValue) return;
      onInitialSearch();
      setQuery(input.value);
      if (input === input.ownerDocument.activeElement && input.value.trim()) setOpen(true);
    },
    [onInitialSearch],
  );
  // 부모가 역을 채워 넣은 경우(기억해 둔 "나", SEO 페이지의 미리 채우기)에도 입력 칸에 이름이 보이게 한다. 부모가 역을 지우면
  // (권역 바꾸기) 칸에 남은 그 역 이름도 지운다. 그사이 사용자가 고쳐 친 글자는 그대로 둔다.
  const lastValue = useRef(value);
  useEffect(() => {
    const previous = lastValue.current;
    lastValue.current = value;
    if (value) setQuery(value.name);
    else if (previous) setQuery((current) => (current === previous.name ? "" : current));
  }, [value]);
  // 검색 결과만 후보로 둔다. 고른 역을 목록 맨 앞에 끼워 넣으면(예전 방식) 다른 역을 새로 칠 때 그 역이 첫 후보가 되어
  // 자동 하이라이트·Enter가 고른 역을 다시 고르고, 정확 일치("강남")는 두 번째로 밀렸다. 입력 칸 글자는 우리가 정하므로(inputValue)
  // 고른 역이 목록에 없어도 표시에는 영향이 없다.
  //
  // 한글은 조합 중인 글자까지 찾는다(#177). Base UI는 IME 조합 중에는 inputValue를 넘기지 않아(안드로이드 제외) 목록이 입력 칸보다
  // 한 글자 늦다("서울대"를 쳐도 "서울" 목록). macOS는 마우스를 누르는 순간 조합을 먼저 확정하므로, 확정으로 목록이 바뀌어 누른
  // 자리의 항목이 사라지고 누름이 목록 아래 칸에 떨어졌다. 보이는 글자로 찾으면 확정해도 목록이 그대로다.
  const composingRef = useRef(false);
  const [composing, setComposing] = useState<string | null>(null);
  const choices = useMemo(() => searchInScope(composing ?? query, scope), [composing, query, scope]);
  const items = useMemo(() => choices.map((c) => c.station), [choices]);
  const choiceOf = useMemo(() => new Map(choices.map((c) => [c.station.code, c])), [choices]);
  // 고른 뒤 요일·시간대를 바꿔 그 구분에 출발할 수 없게 된 역(첫 화면·방 만들기). 칸 아래에 이유를 둔다.
  const valueProblem = value ? blockedReason(value, scope) : null;
  const problemId = `${id}-problem`;
  const describedByAll = [describedBy, valueProblem ? problemId : null].filter(Boolean).join(" ");
  // 조합을 확정하기 전에 역을 고르면(확정이 누름보다 늦는 브라우저) 나중에 오는 확정 글자("서울대")가 입력 칸을 덮는다. 고를 때 진행 중이던
  // 그 조합의 compositionend 한 번만 고른 역 이름으로 바꾸고 바로 잊는다. 그 뒤의 입력·새 조합에는 끼어들지 않는다.
  const pickedWhileComposing = useRef<string | null>(null);
  // 항목을 누른 포인터 종류. 선택 click의 pointerType은 브라우저마다 다르다(iOS WebKit 탭은 터치가 아닐 수 있다).
  const itemPointerType = useRef<string | null>(null);
  const composingEmpty = composing !== null && items.length === 0;
  const other = useMemo(() => (composing === null ? elsewhere(query, scope) : null), [composing, query, scope]);

  return (
    <Combobox<Station>
      items={items}
      filter={null}
      open={onInitialSearch ? open : undefined}
      onOpenChange={onInitialSearch ? setOpen : undefined}
      value={value}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") {
          guardFollowUpPress(details.event, itemPointerType.current);
          itemPointerType.current = null;
          pickedWhileComposing.current = composingRef.current && next ? next.name : null;
        }
        onChange(next);
      }}
      inputValue={query}
      onInputValueChange={(next, details) => {
        const picked = pickedWhileComposing.current;
        if (details.reason === "input-change") pickedWhileComposing.current = null;
        setQuery(picked !== null && details.event?.type === "compositionend" ? picked : next);
      }}
      itemToStringLabel={(s) => s.name}
      itemToStringValue={(s) => s.code}
      isItemEqualToValue={(a, b) => a.code === b.code}
      autoHighlight
    >
      <ComboboxInput
        ref={onInitialSearch ? readInitialInput : undefined}
        id={id}
        placeholder="역 이름 입력 (예: 홍대입구)"
        autoComplete="off"
        enterKeyHint="next"
        showClear={query.length > 0}
        onCompositionStart={() => {
          composingRef.current = true;
          pickedWhileComposing.current = null;
        }}
        onInput={(e) => {
          if (composingRef.current) setComposing(e.currentTarget.value);
        }}
        onCompositionEnd={() => {
          // Base UI가 같은 이벤트에서 확정한 글자를 inputValue로 넘기므로(setQuery) 한 번에 그려지고 목록은 바뀌지 않는다.
          composingRef.current = false;
          setComposing(null);
        }}
        {...(describedByAll ? { "aria-describedby": describedByAll } : {})}
      />
      {/* 조합 중에는 결과가 없어도 '없음' 안내를 미루고(다음 자모에 다시 맞을 수 있다) 빈 목록은 그리지 않는다. */}
      <ComboboxContent className={composingEmpty ? "hidden" : undefined}>
        <ComboboxEmpty>
          {query.trim() && composing === null ? (
            other && scope.region !== null ? (
              <ElsewhereHint other={other} region={scope.region} onSwitchRegion={onSwitchRegion} />
            ) : (
              <NoStationMatch region={scope.region ?? DEFAULT_REGION} />
            )
          ) : null}
        </ComboboxEmpty>
        <ComboboxList>
          {(station: Station) => {
            const blocked = choiceOf.get(station.code)?.blocked ?? null;
            const tag = choiceOf.get(station.code)?.tag ?? null;
            return (
              <ComboboxItem
                key={station.code}
                value={station}
                disabled={blocked !== null}
                onPointerDown={(e) => {
                  itemPointerType.current = e.pointerType;
                }}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className={blocked ? "font-semibold text-muted-foreground" : "font-semibold text-ink"}>
                      {station.name}
                    </span>
                    {tag ? <span className="text-xs font-semibold text-ink-soft">{tag}</span> : null}
                    <LineBadges lines={station.lines} />
                  </span>
                  {blocked ? <span className="text-xs text-muted-foreground">{blocked}</span> : null}
                </span>
              </ComboboxItem>
            );
          }}
        </ComboboxList>
        {items.length > 0 && other && scope.region !== null ? (
          <div className="border-t border-rule px-3 py-3 text-sm text-muted-foreground">
            <ElsewhereHint other={other} region={scope.region} onSwitchRegion={onSwitchRegion} />
          </div>
        ) : null}
      </ComboboxContent>
      {/* Combobox 뿌리는 요소를 그리지 않아 이 줄은 입력 칸 바로 아래에 놓인다. */}
      {valueProblem ? (
        <p id={problemId} className="text-[13px] font-semibold text-destructive">
          {valueProblem}
        </p>
      ) : null}
    </Combobox>
  );
}

/**
 * 고른 권역 밖의 역 안내. 빈 목록 대신, 또는 다른 권역에만 정확히 같은 이름이 있으면 목록 아래에 "부산권에 서면이 있어요"와
 * 바꾸기 버튼(첫 화면·방 만들기)이나 이 방에서 고를 수 있는 권역(방 참여)을 말한다. 첫 칸에서 권역을 저절로 바꾸지는 않는다.
 */
function ElsewhereHint({
  other,
  region,
  onSwitchRegion,
}: {
  other: Elsewhere;
  region: RegionId;
  onSwitchRegion: ((region: RegionId) => void) | undefined;
}) {
  const target = regionName(other.region);
  return (
    <span className="flex flex-col items-start gap-2">
      <span className="font-semibold text-ink">
        {target}
        {other.alsoHere ? "에도" : "에"} {withJosa(other.name, "이/가")} 있어요
      </span>
      {onSwitchRegion ? (
        <Button
          type="button"
          variant="outline"
          onClick={() => onSwitchRegion(other.region)}
          className="h-11 border-rule-strong bg-surface px-3 text-[14px] font-semibold text-ink hover:border-ink"
        >
          {target}으로 바꾸기
        </Button>
      ) : (
        <span>이 방에서는 {regionName(region)} 역만 고를 수 있어요.</span>
      )}
    </span>
  );
}

/** 두 번 탭의 두 번째 탭을 기다리는 시간(모바일 두 번 탭 간격은 이보다 짧다). */
const FOLLOW_UP_TAP_MS = 500;
/** 두 번째 탭을 같은 자리로 보는 거리(px). */
const FOLLOW_UP_TAP_RADIUS = 24;
/** 탭이 click 없이 끝났을 때(끌기 등) 그 탭을 끝난 것으로 보는 시간. */
const TAP_END_FALLBACK_MS = 1000;
const MOUSE_EVENTS = ["mousedown", "mouseup", "click", "dblclick"] as const;
const TAP_EVENTS = [
  "pointerdown",
  "pointerup",
  "pointercancel",
  "touchstart",
  "touchend",
  "touchcancel",
  "mousedown",
  "mouseup",
  "click",
] as const;

type Area = { left: number; right: number; top: number; bottom: number };

const swallow = (event: Event) => {
  if (event.cancelable && !event.type.startsWith("touch") && !event.type.startsWith("pointer")) event.preventDefault();
  event.stopPropagation();
};

/**
 * 목록 항목을 마우스·손가락으로 고르면 목록은 곧바로 닫힘 상태가 되어 포인터를 받지 않고, 그 아래 칸이 드러난다. 같은 자리를 이어
 * 누르는 두 번째 누름이 드러난 칸(추천 기준·'참여하기'·'한 명 더' 등)을 누르지 않게, 그 누름만 문서에 닿기 전에(window 캡처) 삼킨다(#177).
 * - 마우스: 운영체제가 같은 연속 클릭으로 센 누름(`detail` 2 이상)이 목록 자리에서 시작하면 mousedown부터 click까지 삼킨다. 따로 누른
 *   클릭(`detail` 1)은 그대로 닿는다.
 * - 손가락·펜: iOS WebKit은 두 번째 탭도 `detail`이 1이라, 고른 뒤 `FOLLOW_UP_TAP_MS` 안에 목록 자리이면서 고른 자리
 *   `FOLLOW_UP_TAP_RADIUS` 안에서 시작한 탭을 그 pointerId의 pointerdown부터 click까지 삼킨다.
 * 키보드·보조기기의 직접 활성화(`detail` 0인 click)는 어느 경우에도 막지 않는다. 다른 곳에서 누르기 시작하면 바로 풀린다.
 */
function guardFollowUpPress(selection: Event, itemPointerType: string | null) {
  const target = selection.target instanceof Element ? selection.target : null;
  const view = target?.ownerDocument.defaultView;
  if (!target || !view || !(selection instanceof view.MouseEvent)) return;
  if (selection.type === "click" && selection.detail === 0) return; // 키보드 Enter가 부른 click
  const list = target.closest('[data-slot="combobox-content"]');
  if (!list) return;
  const rect = list.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // 배치가 없으면(jsdom 등) 가릴 자리도 없다.
  // 페이지 좌표로 둔다: 고른 뒤 화면이 스크롤되면(scroll 이벤트가 누름보다 늦게 올 수도 있다) 같은 화면 좌표라도 다른 곳이다.
  const area: Area = {
    left: rect.left + view.scrollX,
    right: rect.right + view.scrollX,
    top: rect.top + view.scrollY,
    bottom: rect.bottom + view.scrollY,
  };
  // 항목을 누른 pointerdown의 종류가 먼저다(iOS WebKit의 탭 click은 pointerType이 터치가 아닐 수 있다).
  const pointerType =
    itemPointerType ||
    ("pointerType" in selection && typeof selection.pointerType === "string" && selection.pointerType) ||
    "mouse";
  const picked = { x: selection.clientX + view.scrollX, y: selection.clientY + view.scrollY };
  if (pointerType === "mouse") guardMouseFollowUp(view, area);
  else guardTapFollowUp(view, area, picked, selection.timeStamp);
}

function inArea(win: Window, area: Area, event: MouseEvent): boolean {
  const x = event.clientX + win.scrollX;
  const y = event.clientY + win.scrollY;
  return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
}

function guardMouseFollowUp(win: Window, area: Area) {
  let pressing = false;
  const release = () => {
    for (const type of MOUSE_EVENTS) win.removeEventListener(type, onEvent, true);
  };
  function onEvent(event: Event) {
    const mouse = event as MouseEvent;
    if (event.type === "mousedown") {
      // 새 연속 클릭(detail 1)이거나 목록 자리 밖이면 더는 막을 것이 없다.
      if (mouse.detail < 2 || !inArea(win, area, mouse)) return release();
      pressing = true;
      return swallow(event);
    }
    if (!pressing || mouse.detail < 2) return; // detail 0 click(키보드·보조기기)은 건드리지 않는다.
    swallow(event);
    if (event.type === "click") pressing = false;
  }
  for (const type of MOUSE_EVENTS) win.addEventListener(type, onEvent, true);
}

function guardTapFollowUp(win: Window, area: Area, picked: { x: number; y: number }, pickedAt: number) {
  let tap: { pointerId: number; lifted: boolean } | null = null;
  // 마지막으로 눌리거나 떼어진 포인터. 호환 mouse 이벤트와 click은 pointerId를 믿을 수 없어(iOS WebKit은 탭 click도 pointerId 1)
  // 이것이 그 탭의 포인터일 때만 그 탭의 것으로 본다(손가락을 누른 채 마우스로 다른 칸을 누르는 경우를 가르기 위해).
  let lastPointerId: number | null = null;
  let expired = false;
  let liftTimer: number | undefined;
  const release = () => {
    for (const type of TAP_EVENTS) win.removeEventListener(type, onEvent, true);
    win.clearTimeout(expireTimer);
    win.clearTimeout(liftTimer);
  };
  const endTap = () => {
    tap = null;
    win.clearTimeout(liftTimer);
    if (expired) release();
  };
  function onEvent(event: Event) {
    if (event.type === "pointerdown" || event.type === "pointerup") lastPointerId = (event as PointerEvent).pointerId;
    if (event.type === "pointerdown") {
      const pointer = event as PointerEvent;
      if (tap) return; // 다른 손가락·마우스는 그대로
      const x = pointer.clientX + win.scrollX;
      const y = pointer.clientY + win.scrollY;
      const near = Math.hypot(x - picked.x, y - picked.y) <= FOLLOW_UP_TAP_RADIUS;
      // 시간은 브라우저가 찍은 event.timeStamp로 잰다(메인 스레드가 막혀 타이머가 늦어도 창이 늘지 않는다). 타이머는 정리용이다.
      const late = pointer.timeStamp - pickedAt > FOLLOW_UP_TAP_MS;
      if (expired || late || pointer.pointerType === "mouse" || !near || !inArea(win, area, pointer)) return release();
      tap = { pointerId: pointer.pointerId, lifted: false };
      return swallow(event);
    }
    if (!tap) return;
    if (event.type.startsWith("pointer")) {
      if ((event as PointerEvent).pointerId !== tap.pointerId) return;
      swallow(event);
      if (event.type === "pointercancel") return endTap();
      tap.lifted = true;
      win.clearTimeout(liftTimer);
      liftTimer = win.setTimeout(endTap, TAP_END_FALLBACK_MS);
      return;
    }
    if (event.type.startsWith("touch")) {
      swallow(event);
      if (event.type === "touchcancel") endTap();
      return;
    }
    // 그 탭의 호환 mouse 이벤트와 click. detail 0(키보드·보조기기)과 다른 포인터가 마지막으로 움직인 뒤의 것은 건드리지 않는다.
    if ((event as MouseEvent).detail === 0 || lastPointerId !== tap.pointerId) return;
    swallow(event);
    if (event.type === "click") endTap();
  }
  const expireTimer = win.setTimeout(() => {
    expired = true;
    if (!tap) release();
  }, FOLLOW_UP_TAP_MS);
  for (const type of TAP_EVENTS) win.addEventListener(type, onEvent, true);
}
