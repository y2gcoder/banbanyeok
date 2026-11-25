"use client";

import { useEffect, useMemo, useState } from "react";
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
  const items = useMemo(() => searchStations(query), [query]);

  return (
    <Combobox<Station>
      items={items}
      filter={null}
      value={value}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") swallowFollowUpClicks(details.event);
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

const FOLLOW_UP_CLICK_EVENTS = ["mousedown", "mouseup", "click", "dblclick"] as const;

/**
 * 목록 항목을 마우스·손가락으로 고르면 목록은 곧바로 닫힘 상태가 되어 포인터를 받지 않고, 그 아래 칸이 드러난다. 같은 자리에서
 * 이어지는 누름(더블클릭·두 번 탭의 두 번째, `detail` 2 이상)이 드러난 칸('출발역 이름 숨기기', '한 명 더')을 누르지 않게 그 연속
 * 누름을 문서에 닿기 전에 삼킨다(#177). 새로 누르기 시작하면(`detail` 1인 mousedown) 풀린다. 키보드 선택(`detail` 0)은 건드리지 않는다.
 */
function swallowFollowUpClicks(selection: Event) {
  const win = selection.target instanceof Node ? selection.target.ownerDocument?.defaultView : null;
  if (!win || !(selection instanceof win.UIEvent) || selection.detail < 1) return;
  const onEvent = (event: Event) => {
    const detail = (event as UIEvent).detail;
    if (detail >= 2) {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.type === "mousedown") {
      for (const type of FOLLOW_UP_CLICK_EVENTS) win.removeEventListener(type, onEvent, true);
    }
  };
  for (const type of FOLLOW_UP_CLICK_EVENTS) win.addEventListener(type, onEvent, true);
}
