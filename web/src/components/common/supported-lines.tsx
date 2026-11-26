"use client";

import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { LineBadges } from "@/components/common/line-badge";
import { useChosenRegion } from "@/components/common/region-choice";
import type { RegionId } from "@/lib/stations";
import { regionScope } from "@/lib/stations/coverage";

/** 첫 화면의 계산 범위 한 줄(#170). 고른 권역을 따라간다. 누르면 노선 배지 목록이 펼쳐진다. 목록·개수는 역 인덱스에서 계산한다. */
export function SupportedLinesDisclosure() {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { lines, excluded, summary } = regionScope(useChosenRegion());
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="-mx-1 inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-[15px] font-semibold text-ink-soft underline decoration-rule-strong underline-offset-4 hover:text-ink wide:text-[16px]"
      >
        {summary}
        <ChevronDownIcon className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      <div id={panelId} hidden={!open} className="flex flex-col gap-2">
        <LineBadges lines={lines} />
        {excluded.length > 0 ? (
          <p className="text-[13px] leading-snug text-muted-foreground">
            {excluded.join(", ")}은 아직 계산하지 않아요.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * 역 검색 결과가 없을 때의 안내(#170). 오타일 수도, 그 권역 밖 역일 수도 있어 둘 다 말한다.
 * 이 영역은 알림(status, aria-atomic)이라 바뀔 때마다 통째로 읽힌다. 노선 24개를 매번 읽지 않게 배지는 화면에만 두고,
 * 목록은 첫 화면의 펼침 단추로 읽을 수 있다.
 */
export function NoStationMatch({ region }: { region: RegionId }) {
  const { lines, summary } = regionScope(region);
  return (
    <span className="flex flex-col gap-2">
      <span className="font-semibold text-ink">찾는 역이 없어요</span>
      <span>아직 {summary.replace("을 계산해요", "만 계산해요")}. 이름이 맞는지도 확인해 주세요.</span>
      <span aria-hidden="true">
        <LineBadges lines={lines} />
      </span>
    </span>
  );
}
