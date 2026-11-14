import { Suspense } from "react";
import { decodeShareQuery } from "@/lib/link/codec";
import { toQueryString } from "@/lib/result/share-url";
import { InvalidLink } from "./invalid-link";
import { ResultLoader } from "./result-loader";
import { LoadingCard, type ResultVariant } from "./result-screen";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** `/result`와 `/s`가 같이 쓰는 페이지 본문. 링크 상태를 해석하고 결과를 스트리밍한다. */
export async function ResultPage({ searchParams, variant }: { searchParams: SearchParams; variant: ResultVariant }) {
  const decoded = decodeShareQuery(toQueryString(await searchParams));
  if (!decoded.ok) return <InvalidLink error={decoded.error} />;
  return (
    // 서버가 콜드스타트 중이어도 화면 골격은 바로 보인다. 결과는 준비되는 대로 스트리밍한다.
    // 대기 화면은 쿼리 캐시를 건드리지 않아야 한다(같은 키를 먼저 만들면 HydrationBoundary가 수화를 effect로 미뤄 불일치가 난다).
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 pt-4 pb-10">
          <div className="h-11 w-full rounded-xl bg-muted" />
          <LoadingCard />
        </main>
      }
    >
      <ResultLoader state={decoded.state} variant={variant} />
    </Suspense>
  );
}
