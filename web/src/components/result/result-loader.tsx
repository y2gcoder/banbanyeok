import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import { recommendQueryOptions } from "@/lib/api/queries";
import type { ShareState } from "@/lib/link/codec";
import { ResultScreen, type ResultVariant } from "./result-screen";

/**
 * 서버 컴포넌트에서 첫 결과를 미리 받아 TanStack Query 캐시로 넘긴다. 실패하면(서버가 깨는 중 등) 비워 두고
 * 클라이언트가 다시 부른다(prefetchQuery는 오류를 던지지 않는다).
 */
export async function ResultLoader({ state, variant }: { state: ShareState; variant: ResultVariant }) {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery(recommendQueryOptions(state));
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <ResultScreen initial={state} variant={variant} />
    </HydrationBoundary>
  );
}
