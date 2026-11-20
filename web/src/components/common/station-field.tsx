"use client";

import { useEffect, useMemo, useState } from "react";
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
