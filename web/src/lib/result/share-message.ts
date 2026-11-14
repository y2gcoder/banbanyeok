import { formatMinutes } from "@/lib/display/minutes";
import type { CandidateView } from "./view-model";

/**
 * 공유 문구(product-ux 4.4): 제목 "{1위역}에서 볼까?", 설명 "{이름} {분} · {이름} {분} · {모드}로 고름".
 * 미리보기만 봐도 각자 시간이 보이게 한다.
 */
export function shareMessage(top: CandidateView, modeName: string): { title: string; text: string } {
  const times = top.people.map((p) => `${p.name} ${formatMinutes(p.minutes)}`).join(" · ");
  return { title: `${top.stationName}에서 볼까?`, text: `${times} · ${modeName}로 고름` };
}
