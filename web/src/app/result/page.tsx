import type { Metadata } from "next";
import { ResultPage, type SearchParams } from "@/components/result/result-page";
import { sharedLinkMetadata } from "@/lib/seo/metadata";

// 만든 사람의 결과 화면. 색인하지 않고, 레이아웃의 홈 canonical·og:url을 물려받지 않는다.
export const metadata: Metadata = sharedLinkMetadata(null);

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <ResultPage searchParams={searchParams} variant="creator" />;
}
