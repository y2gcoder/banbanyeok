import type { Metadata } from "next";
import { ResultPage, type SearchParams } from "@/components/result/result-page";

export const metadata: Metadata = { title: "만날 역 후보", robots: { index: false } };

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return <ResultPage searchParams={searchParams} variant="creator" />;
}
