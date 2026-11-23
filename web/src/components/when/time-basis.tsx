import type { RecommendResult } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { DEFAULT_SLOT, slotLabel, type TimeSlot } from "@/lib/when/time-slot";

/**
 * 결과의 계산 기준 한 줄: "역에서 역까지, 토요일 저녁 기준 시간." 문구는 서버가 준 `timeBasis.label`을 그대로 쓴다.
 * 서버가 요청한 구분(`requestedTimeSlot`)과 다른 기준으로 계산했으면(구분 행렬이 없거나 검증 실패·시간 초과) 그 사실을 함께 알린다.
 * 결과가 오기 전에는 요청한 구분으로 보여 준다. 결과에 timeBasis가 없으면(구분을 모르는 옛 서버) 평일 낮으로 계산된 것이다.
 */
export function TimeBasisNote({
  basis,
  requested,
  className,
}: {
  /** 결과가 아직 없으면 undefined, 결과에 기준이 없으면 null(옛 서버 = 평일 낮). */
  basis: RecommendResult["timeBasis"] | null | undefined;
  /** 이 화면이 요청한 구분. 서버가 알려 주면(`requestedTimeSlot`) 그 값을 쓴다. 방은 서버가 정하므로 null. */
  requested: TimeSlot | null;
  className?: string;
}) {
  const used = basis === null ? DEFAULT_SLOT : basis?.timeSlot;
  const label = basis?.label ?? (used ? slotLabel(used) : requested ? slotLabel(requested) : null);
  if (!label) return null;
  const asked = basis?.requestedTimeSlot ?? requested;
  const fellBack = used !== undefined && asked !== null && used !== asked;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      역에서 역까지, {label}
      {basis?.holidayName ? `(${basis.holidayName})` : ""} 기준 시간.
      {fellBack && asked ? ` ${slotLabel(asked)} 시간은 지금 계산하지 못해 ${label} 기준으로 보여 드려요.` : ""}
    </p>
  );
}
