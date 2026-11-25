"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LineBadges } from "@/components/common/line-badge";
import { NoStationMatch } from "@/components/common/supported-lines";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { type Station, searchStations } from "@/lib/stations";
import { unsupportedReason } from "@/lib/stations/coverage";

type Props = {
  id: string;
  value: Station | null;
  onChange: (station: Station | null) => void;
  describedBy?: string;
};

/**
 * 역 자동완성. 초성("ㅎㄷ")·생략형("홍대")·"역" 접미사를 받는다. 계산하지 않는 역은 보이되 고를 수 없고 이유가 붙는다
 * (lib/stations/coverage.ts). 결과가 없으면 계산 범위(수도권 전철 노선)를 함께 알린다.
 */
export function StationField({ id, value, onChange, describedBy }: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  // 부모가 역을 채워 넣은 경우(기억해 둔 "나", SEO 페이지의 미리 채우기)에도 입력 칸에 이름이 보이게 한다.
  useEffect(() => {
    if (value) setQuery(value.name);
  }, [value]);
  // 검색 결과만 후보로 둔다. 고른 역을 목록 맨 앞에 끼워 넣으면(예전 방식) 다른 역을 새로 칠 때 그 역이 첫 후보가 되어
  // 자동 하이라이트·Enter가 고른 역을 다시 고르고, 정확 일치("강남")는 두 번째로 밀렸다. 입력 칸 글자는 우리가 정하므로(inputValue)
  // 고른 역이 목록에 없어도 표시에는 영향이 없다.
  //
  // 한글은 조합 중인 글자까지 찾는다(#177). Base UI는 IME 조합 중에는 inputValue를 넘기지 않아(안드로이드 제외) 목록이 입력 칸보다
  // 한 글자 늦다("서울대"를 쳐도 "서울" 목록). macOS는 마우스를 누르는 순간 조합을 먼저 확정하므로, 확정으로 목록이 바뀌어 누른
  // 자리의 항목이 사라지고 누름이 목록 아래('출발역 이름 숨기기')에 떨어졌다. 보이는 글자로 찾으면 확정해도 목록이 그대로다.
  const composingRef = useRef(false);
  const [composing, setComposing] = useState<string | null>(null);
  const items = useMemo(() => searchStations(composing ?? query), [composing, query]);

  return (
    <Combobox<Station>
      items={items}
      filter={null}
      value={value}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") guardFollowUpPress(details.event);
        onChange(next);
      }}
      inputValue={query}
      onInputValueChange={setQuery}
      itemToStringLabel={(s) => s.name}
      itemToStringValue={(s) => s.code}
      isItemEqualToValue={(a, b) => a.code === b.code}
      autoHighlight
    >
      <ComboboxInput
        id={id}
        placeholder="역 이름 입력 (예: 홍대입구)"
        autoComplete="off"
        enterKeyHint="next"
        showClear={query.length > 0}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onInput={(e) => {
          if (composingRef.current) setComposing(e.currentTarget.value);
        }}
        onCompositionEnd={() => {
          // Base UI가 같은 이벤트에서 확정한 글자를 inputValue로 넘기므로(setQuery) 한 번에 그려지고 목록은 바뀌지 않는다.
          composingRef.current = false;
          setComposing(null);
        }}
        {...(describedBy ? { "aria-describedby": describedBy } : {})}
      />
      <ComboboxContent>
        <ComboboxEmpty>{query.trim() ? <NoStationMatch /> : null}</ComboboxEmpty>
        <ComboboxList>
          {(station: Station) => (
            <ComboboxItem key={station.code} value={station} disabled={!station.supported}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span
                    className={station.supported ? "font-semibold text-ink" : "font-semibold text-muted-foreground"}
                  >
                    {station.name}
                  </span>
                  <LineBadges lines={station.lines} />
                </span>
                {station.supported ? null : (
                  <span className="text-xs text-muted-foreground">{unsupportedReason(station)}</span>
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/** 더블클릭·두 번 탭으로 이어지는 두 번째 누름을 기다리는 시간(macOS 기본 더블클릭 간격, 모바일 두 번 탭은 이보다 짧다). */
const FOLLOW_UP_PRESS_MS = 500;
/** 두 번째 누름을 같은 자리로 보는 거리(px). 손가락 두 번 탭은 마우스보다 조금 더 벌어진다. */
const FOLLOW_UP_PRESS_RADIUS = 24;
/** 누름이 click 없이 끝났을 때(끌기 등) 그 누름을 끝난 것으로 보는 시간. */
const PRESS_END_FALLBACK_MS = 1000;
const PRESS_START_EVENTS = new Set(["pointerdown", "touchstart", "mousedown"]);
const PRESS_EVENTS = [
  "pointerdown",
  "touchstart",
  "mousedown",
  "pointerup",
  "touchend",
  "mouseup",
  "pointercancel",
  "touchcancel",
  "click",
  "dblclick",
] as const;

function pressPoint(event: Event): { x: number; y: number } | null {
  if ("touches" in event) {
    const touch = (event as TouchEvent).touches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  if ("clientX" in event) return { x: (event as MouseEvent).clientX, y: (event as MouseEvent).clientY };
  return null;
}

/**
 * 목록 항목을 마우스·손가락으로 고르면 목록은 곧바로 닫힘 상태가 되어 포인터를 받지 않고, 그 아래 칸이 드러난다. 더블클릭·두 번
 * 탭의 두 번째 누름이 드러난 칸('출발역 이름 숨기기', '한 명 더')을 누르지 않게, 고른 뒤 잠깐(`FOLLOW_UP_PRESS_MS`) 목록이 있던
 * 자리 안이면서 고른 자리 가까이(`FOLLOW_UP_PRESS_RADIUS`)에서 시작한 누름을 pointerdown부터 click까지 문서에 닿기 전에 삼킨다
 * (#177). 그 누름이 끝나기 전에는 풀지 않는다. 누름의 횟수(`detail`)에는 기대지 않는다(iOS WebKit 터치는 두 번째 탭도 1이다).
 * 다른 곳에서 누르기 시작하면(목록 자리의 다른 칸을 바로 누르는 것도) 바로 풀리고, 키보드로 고른 경우(키 이벤트, `detail` 0인
 * click)는 건드리지 않는다.
 */
function guardFollowUpPress(selection: Event) {
  const target = selection.target instanceof Element ? selection.target : null;
  const view = target?.ownerDocument.defaultView;
  if (!target || !view || !(selection instanceof view.MouseEvent)) return;
  const win: Window = view;
  if (selection.type === "click" && selection.detail === 0) return; // 키보드 Enter가 부른 click
  const list = target.closest('[data-slot="combobox-content"]');
  if (!list) return;
  // 페이지 좌표로 둔다: 고른 뒤 화면이 스크롤되면(scroll 이벤트가 누름보다 늦게 올 수도 있다) 같은 화면 좌표라도 다른 곳이다.
  const rect = list.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // 배치가 없으면(jsdom 등) 가릴 자리도 없다.
  const area = {
    left: rect.left + win.scrollX,
    right: rect.right + win.scrollX,
    top: rect.top + win.scrollY,
    bottom: rect.bottom + win.scrollY,
  };
  const picked = { x: selection.clientX + win.scrollX, y: selection.clientY + win.scrollY };
  const isFollowUp = ({ x, y }: { x: number; y: number }) => {
    const pageX = x + win.scrollX;
    const pageY = y + win.scrollY;
    const inArea = pageX >= area.left && pageX <= area.right && pageY >= area.top && pageY <= area.bottom;
    return inArea && Math.hypot(pageX - picked.x, pageY - picked.y) <= FOLLOW_UP_PRESS_RADIUS;
  };

  let pressing = false;
  let expired = false;
  let pressEndTimer: number | undefined;
  const release = () => {
    for (const type of PRESS_EVENTS) win.removeEventListener(type, onEvent, true);
    win.clearTimeout(expireTimer);
    win.clearTimeout(pressEndTimer);
  };
  const endPress = () => {
    pressing = false;
    win.clearTimeout(pressEndTimer);
    if (expired) release();
  };
  function onEvent(event: Event) {
    if (!pressing) {
      if (!PRESS_START_EVENTS.has(event.type)) return;
      const point = pressPoint(event);
      if (expired || !point || !isFollowUp(point)) {
        release();
        return;
      }
      pressing = true;
    }
    if (event.cancelable && !event.type.startsWith("touch") && !event.type.startsWith("pointer"))
      event.preventDefault();
    event.stopPropagation();
    if (event.type === "click" || event.type === "pointercancel" || event.type === "touchcancel") endPress();
    else if (event.type === "pointerup" || event.type === "touchend") {
      win.clearTimeout(pressEndTimer);
      pressEndTimer = win.setTimeout(endPress, PRESS_END_FALLBACK_MS);
    }
  }
  const expireTimer = win.setTimeout(() => {
    expired = true;
    if (!pressing) release();
  }, FOLLOW_UP_PRESS_MS);
  for (const type of PRESS_EVENTS) win.addEventListener(type, onEvent, true);
}
