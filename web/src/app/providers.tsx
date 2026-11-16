"use client";

import { isServer, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type ReactNode, useEffect } from "react";
import { ConsentBanner } from "@/components/consent/consent-banner";
import { startAnalytics } from "@/lib/analytics";
import { pruneExpiredRooms } from "@/lib/room/tokens";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // 서버 컴포넌트가 미리 받은 결과를 곧바로 다시 부르지 않는다.
      queries: { staleTime: 60_000, retry: 1, refetchOnWindowFocus: false },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (isServer) return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  // 만료된 방의 토큰을 이 기기에서 지운다(어느 화면을 열어도 한 번).
  // 동의한 기기면 통계(오류 추적·웹 바이탈 포함)를 시작한다. 동의 전에는 아무것도 하지 않는다.
  useEffect(() => {
    pruneExpiredRooms();
    startAnalytics();
  }, []);
  return (
    <NuqsAdapter>
      <QueryClientProvider client={queryClient}>
        {children}
        <ConsentBanner />
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
