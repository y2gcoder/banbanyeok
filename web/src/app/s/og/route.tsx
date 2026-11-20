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
    return data ? <ScoreboardCard data={data} /> : null;
  });
}
