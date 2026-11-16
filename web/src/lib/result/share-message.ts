import type { Mode, RecommendResult } from "@/lib/api/types";
import { formatMinutes } from "@/lib/display/minutes";
import { DEFAULT_SLOT } from "@/lib/when/time-slot";
import { modeSentence } from "./mode-sentence";
import type { CandidateView } from "./view-model";

/**
 * 공유 문구(product-ux 4.4): 제목 "{1위역}에서 볼까?", 설명 "{짧은 이름} {분} · … · {기준 한 마디}".
 * 미리보기(`/s`의 og:description)와 같은 말이다. 평일 낮이 아닌 기준이면 " · {토요일 저녁} 기준"을 덧붙인다(시간이 그 기준이라서).
 */
export function shareMessage(
  top: CandidateView,
  mode: Mode,
  favorName: string | null,
  basis?: RecommendResult["timeBasis"],
): { title: string; text: string } {
  const times = top.people.map((p) => `${p.shortName} ${formatMinutes(p.minutes)}`).join(" · ");
  const when = basis && basis.timeSlot !== DEFAULT_SLOT ? ` · ${basis.label} 기준` : "";
  return { title: `${top.stationName}에서 볼까?`, text: `${times} · ${modeSentence(mode, favorName)}${when}` };
}
