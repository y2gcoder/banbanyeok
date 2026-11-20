import type { Mode, RecommendResult } from "@/lib/api/types";
import { formatMinutes } from "@/lib/display/minutes";
import type { ShareState } from "@/lib/link/codec";
import type { KakaoFeedMessage } from "@/lib/share/kakao";
import { DEFAULT_SLOT } from "@/lib/when/time-slot";
import { modeSentence } from "./mode-sentence";
import { sharedImagePath, sharePath } from "./share-url";
import type { CandidateView } from "./view-model";

/**
 * 공유 문구(product-ux 4.4): 제목 "{1위역}에서 볼까?", 설명 "{짧은 이름} {분} · … · {기준 한 마디}".
 * 미리보기(`/s`의 og:description)와 같은 말이다. 평일 낮이 아닌 기준이면 " · {토요일 저녁} 기준"을 덧붙이고(시간이 그 기준이라서),
 * 지도 한가운데 비교가 있으면 " · 지도 한가운데인 ○○역이면 ○○은 N분 더 걸려요"를 끝에 붙인다.
 */
export function shareMessage(
  top: CandidateView,
  mode: Mode,
  favorName: string | null,
  basis?: RecommendResult["timeBasis"],
  /** 지도 한가운데 비교 문장(`mapMiddleSentence`). 있으면 설명 끝에 붙는다(미리보기 설명과 같은 말). */
  middle: string | null = null,
): { title: string; text: string } {
  const times = top.people.map((p) => `${p.shortName} ${formatMinutes(p.minutes)}`).join(" · ");
  const when = basis && basis.timeSlot !== DEFAULT_SLOT ? ` · ${basis.label} 기준` : "";
  const compare = middle ? ` · ${middle}` : "";
  return {
    title: `${top.stationName}에서 볼까?`,
    text: `${times} · ${modeSentence(mode, favorName)}${when}${compare}`,
  };
}

/** 혼자 입력한 결과를 카카오톡 공유 API로 보내는 메시지. 공유 시트와 같은 문구이고, 그림은 그 링크(`/s`)의 미리보기 그림이다. */
export function soloKakaoMessage(
  state: ShareState,
  message: { title: string; text: string },
  dataVersion: string,
): KakaoFeedMessage {
  const path = sharePath(state);
  return {
    title: message.title,
    description: message.text,
    imagePath: sharedImagePath(state, dataVersion),
    path,
    buttons: [{ title: "결과 보기", path }],
  };
}
