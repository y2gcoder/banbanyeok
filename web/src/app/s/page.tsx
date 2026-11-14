import type { Metadata } from "next";
import { ResultPage, type SearchParams } from "@/components/result/result-page";

// 동적 OG 이미지와 링크별 제목은 P5(SEO/OG)가 이 경로에 붙인다.
export const metadata: Metadata = { title: "만날 역 후보", robots: { index: false } };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <ResultPage searchParams={searchParams} variant="received" />;
}
