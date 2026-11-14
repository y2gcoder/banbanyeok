"use client";

import { useMemo, useState } from "react";
import { LineBadges } from "@/components/common/line-badge";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { type Station, searchStations } from "@/lib/stations";
import { isCapitalAreaLine } from "@/lib/stations/lines";

/** 계산할 수 없는 역의 안내. 수도권 노선인데 빠진 역(데이터 범위 밖)과 수도권 밖 역을 구분한다. */
function unsupportedReason(station: Station): string {
  return station.lines.some(isCapitalAreaLine)
    ? "이 노선의 역은 아직 계산하지 못해요"
    : "아직 수도권 지하철역만 계산할 수 있어요";
}

type Props = {
  id: string;
  value: Station | null;
  onChange: (station: Station | null) => void;
  describedBy?: string;
};

/** 역 자동완성. 초성("ㅎㄷ")·생략형("홍대")·"역" 접미사를 받는다. 수도권 밖 역은 보이되 고를 수 없다. */
export function StationField({ id, value, onChange, describedBy }: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const items = useMemo(() => {
    const found = searchStations(query);
    // 고른 역은 목록에 항상 있어야 Combobox가 값을 표시한다.
    return value && !found.some((s) => s.code === value.code) ? [value, ...found] : found;
  }, [query, value]);

  return (
    <Combobox<Station>
      items={items}
      filter={null}
      value={value}
      onValueChange={(next) => onChange(next)}
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
        <ComboboxEmpty>{query.trim() ? "찾는 역이 없어요. 역 이름을 다시 확인해 주세요." : null}</ComboboxEmpty>
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
