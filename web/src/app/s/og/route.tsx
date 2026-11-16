import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { SharedCard } from "@/components/og/shared-card";
import { SiteCard } from "@/components/og/site-card";
import { decodeShareQuery } from "@/lib/link/codec";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { loadSharedView, sharedCardData } from "@/lib/seo/shared-preview";
import { absoluteUrl } from "@/lib/seo/site";

// 공유 링크별 미리보기. 링크마다 내용이 달라 요청 때 그린다(조합 페이지와 달리 정적으로 만들 수 없다).
export const dynamic = "force-dynamic";

const size = { width: OG_WIDTH, height: OG_HEIGHT };
/** 같은 주소(`dv`에 데이터 버전이 들어 있다)는 같은 그림이다. 기본 그림은 곧 다시 시도하게 짧게만 둔다. */
const CACHE_OK = "public, max-age=86400, s-maxage=86400";
const CACHE_FALLBACK = "public, max-age=60";
/**
 * 시간 예산. 링크 그림(서버 결과 받기 + 그리기)은 1.5초, 그게 안 되면 기본 그림 그리기에 0.5초. 둘 다 안 되면 빌드 때 만든
 * 정적 기본 이미지(`/opengraph-image`)로 302 보낸다. 어느 경우에도 500을 내지 않는다(크롤러가 오래 기다려 주지 않고, 깨진 그림보다 기본 그림이 낫다).
 * `/s` HTML을 먼저 스크랩하며 서버가 이미 깨어 있으므로 평소에는 첫 단계에서 끝난다.
 */
const SHARED_BUDGET_MS = 1500;
const FALLBACK_BUDGET_MS = 500;

/**
 * `work`를 예산 안에서 돌린다. 넘으면 신호를 중단(abort)해 진행 중인 서버 호출을 끊고 null. 실패해도 null.
 * 끝나면(성공 포함) 신호를 중단해 남은 작업이 계속 돌지 않게 한다.
 */
async function withinBudget<T>(ms: number, work: (signal: AbortSignal) => Promise<T | null>): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const aborted = new Promise<null>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(null), { once: true });
  });
  try {
    return await Promise.race([work(controller.signal).catch(() => null), aborted]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * PNG 바이트. 다 그린 뒤 돌려주므로 그리기 실패도 잡힌다. satori·resvg의 계산은 도중에 끊을 수 없어 단계 사이(글꼴 뒤·그리기 전)에 신호를 본다:
 * 예산을 넘긴 뒤에는 새 그리기를 시작하지 않는다.
 */
async function draw(element: () => ReactElement | null, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const fonts = await ogFonts();
  signal.throwIfAborted();
  const body = element();
  if (!body) return null;
  return new ImageResponse(body, { ...size, fonts }).arrayBuffer();
}

/** 링크의 그림. 잘못된 링크·서버 실패·중단이면 null. */
async function drawShared(search: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const decoded = decodeShareQuery(search);
  if (!decoded.ok) return null;
  const view = await loadSharedView(decoded.state, signal);
  signal.throwIfAborted();
  const data = view ? sharedCardData(view, decoded.state) : null;
  return data ? draw(() => <SharedCard data={data} />, signal) : null;
}

function png(bytes: ArrayBuffer, cache: string): Response {
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": cache } });
}

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).search;
    const shared = await withinBudget(SHARED_BUDGET_MS, (signal) => drawShared(search, signal));
    if (shared) return png(shared, CACHE_OK);
    const site = await withinBudget(FALLBACK_BUDGET_MS, (signal) => draw(() => <SiteCard />, signal));
    if (site) return png(site, CACHE_FALLBACK);
  } catch {
    // 아래 정적 이미지로 간다.
  }
  return new Response(null, {
    status: 302,
    headers: { Location: absoluteUrl("/opengraph-image"), "Cache-Control": CACHE_FALLBACK },
  });
}
