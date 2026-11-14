import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { recommendQueryOptions, takeResponseMillis } from "@/lib/api/queries";
import type { ShareState } from "@/lib/link/codec";
import { ResultScreen, type ResultVariant } from "./result-screen";

/**
 * 서버 컴포넌트에서 첫 결과를 미리 받아 TanStack Query 캐시로 넘긴다. 실패하면(서버가 깨는 중 등) 비워 두고
 * 클라이언트가 다시 부른다(prefetchQuery는 오류를 던지지 않는다).
 */
export async function ResultLoader({ state, variant }: { state: ShareState; variant: ResultVariant }) {
  const queryClient = new QueryClient();
  const options = recommendQueryOptions(state);
  await queryClient.prefetchQuery(options);
  // 서버가 미리 받은 경우의 응답 시간. 통계(응답 시간 구간)에 쓰도록 화면에 넘긴다.
  const prefetched = queryClient.getQueryData(options.queryKey);
  const responseMs = prefetched ? takeResponseMillis(prefetched) : undefined;
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResultScreen initial={state} variant={variant} initialResponseMs={responseMs} />
    </HydrationBoundary>
  );
}
