import type { RecommendResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DEFAULT_SLOT, slotLabel, type TimeSlot } from "@/lib/when/time-slot";

/**
 * 결과의 계산 기준 한 줄: "역에서 역까지, 토요일 저녁 기준 시간이에요." 문구는 서버가 준 `timeBasis.label`을 그대로 쓴다.
 * 요청한 구분과 실제 기준이 다르면(서버 데이터에 그 구분이 아직 없을 때) 그 사실을 함께 알린다.
 * 결과가 오기 전에는 요청한 구분으로 보여 준다. 결과에 timeBasis가 없으면(구분을 모르는 옛 서버) 평일 낮으로 계산된 것이다.
 */
export function TimeBasisNote({
  basis,
  requested,
  className,
}: {
  /** 결과가 아직 없으면 undefined, 결과에 기준이 없으면 null(옛 서버 = 평일 낮). */
  basis: RecommendResult["timeBasis"] | null | undefined;
  requested: TimeSlot | null;
  className?: string;
}) {
  const used = basis === null ? DEFAULT_SLOT : basis?.timeSlot;
  const label = basis?.label ?? (used ? slotLabel(used) : requested ? slotLabel(requested) : null);
  if (!label) return null;
  const fellBack = used !== undefined && requested !== null && used !== requested;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      역에서 역까지, {label}
      {basis?.holidayName ? `(${basis.holidayName})` : ""} 기준 시간이에요.
      {fellBack && requested ? ` ${slotLabel(requested)} 시간표는 아직 준비 중이라 ${label} 기준으로 보여 드려요.` : ""}
    </p>
  );
}
