import type { RecommendResult } from "@/lib/api/types";
import { formatMinutes } from "@/lib/display/minutes";
import { DEFAULT_SLOT } from "@/lib/when/time-slot";
import type { CandidateView } from "./view-model";

/**
 * 공유 문구(product-ux 4.4): 제목 "{1위역}에서 볼까?", 설명 "{이름} {분} · {이름} {분} · {모드}로 고름".
 * 미리보기만 봐도 각자 시간이 보이게 한다. 평일 낮이 아닌 기준이면 " · {토요일 저녁} 기준"을 덧붙인다(시간이 그 기준이라서).
 */
export function shareMessage(
  top: CandidateView,
  modeName: string,
  basis?: RecommendResult["timeBasis"],
): { title: string; text: string } {
  const times = top.people.map((p) => `${p.name} ${formatMinutes(p.minutes)}`).join(" · ");
  const when = basis && basis.timeSlot !== DEFAULT_SLOT ? ` · ${basis.label} 기준` : "";
  return { title: `${top.stationName}에서 볼까?`, text: `${times} · ${modeName}로 고름${when}` };
}
