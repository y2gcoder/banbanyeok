import type { Metadata } from "next";
import { ResultPage, type SearchParams } from "@/components/result/result-page";
import { decodeShareQuery } from "@/lib/link/codec";
import { toQueryString } from "@/lib/result/share-url";
import { sharedLinkMetadata } from "@/lib/seo/metadata";
import { loadSharedView, sharedImagePath, sharedPreview } from "@/lib/seo/shared-preview";

type Props = { searchParams: SearchParams };

/**
 * 링크별 미리보기(카카오톡 등): 제목은 "{1위역}에서 볼까?", 설명은 각자 시간, 이미지는 `/s/og`.
 * 서버가 3초 안에 못 답하면 기본 미리보기로 간다. 개인이 만든 링크라 색인하지 않는다(robots.txt로 막지 않아 미리보기 크롤러는 읽을 수 있다).
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const decoded = decodeShareQuery(toQueryString(await searchParams));
  if (!decoded.ok) return sharedLinkMetadata(null);
  const view = await loadSharedView(decoded.state);
  const preview = view ? sharedPreview(view, decoded.state) : null;
  return sharedLinkMetadata(
    view && preview ? { ...preview, imagePath: sharedImagePath(decoded.state, view.dataVersion) } : null,
  );
}

export default function Page({ searchParams }: Props) {
  return <ResultPage searchParams={searchParams} variant="received" />;
}
