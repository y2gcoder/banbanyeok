import type { RecommendResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { slotLabel, type TimeSlot } from "@/lib/when/time-slot";

/**
 * 결과의 계산 기준 한 줄: "역에서 역까지, 토요일 저녁 기준 시간이에요." 문구는 서버가 준 `timeBasis.label`을 그대로 쓴다.
 * 요청한 구분과 실제 기준이 다르면(서버 데이터에 그 구분이 아직 없을 때) 그 사실을 함께 알린다.
 * 결과가 오기 전에는 요청한 구분으로 보여 준다.
 */
export function TimeBasisNote({
  basis,
  requested,
  className,
}: {
  basis: RecommendResult["timeBasis"] | undefined;
  requested: TimeSlot | null;
  className?: string;
}) {
  const label = basis?.label ?? (requested ? slotLabel(requested) : null);
  if (!label) return null;
  const fellBack = basis !== undefined && requested !== null && basis.timeSlot !== requested;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      역에서 역까지, {label}
      {basis?.holidayName ? `(${basis.holidayName})` : ""} 기준 시간이에요.
      {fellBack && requested ? ` ${slotLabel(requested)} 시간표는 아직 준비 중이라 ${label} 기준으로 보여 드려요.` : ""}
    </p>
  );
}
