import { ogImageResponse } from "@/components/og/og-response";
import { ScoreboardCard } from "@/components/og/scoreboard-card";
import { decodeShareQuery } from "@/lib/link/codec";
import { loadSharedView } from "@/lib/seo/shared-preview";
import { scoreboardCardData } from "@/lib/share-card/scoreboard-card-data";

// 공유 링크별 미리보기. 링크마다 내용이 달라 요청 때 그린다(조합 페이지와 달리 정적으로 만들 수 없다).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const search = new URL(request.url).search;
  return ogImageResponse(async (signal) => {
    const decoded = decodeShareQuery(search);
    if (!decoded.ok) return null;
    const view = await loadSharedView(decoded.state, signal);
    const data = view ? scoreboardCardData(view, decoded.state) : null;
    if (!view || !data) return null;
    // 막 뜬 서버가 막차 표를 아직 읽는 중이면 막차 줄이 빠진 그림이다: 같은 주소에 곧 완전한 그림이 오므로 짧게 캐시한다.
    // 옛 링크(v=1, 구분을 고른 적 없음)는 원래 막차 줄을 그리지 않으므로 기다릴 것이 없다.
    const provisional = view.lastTrainPending && decoded.state.slotDefaulted !== true;
    return { element: <ScoreboardCard data={data} />, provisional };
  });
}
