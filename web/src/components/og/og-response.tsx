import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { ogFonts } from "@/lib/seo/og-font";
import { OG_HEIGHT, OG_WIDTH } from "@/lib/seo/og-text";
import { absoluteUrl } from "@/lib/seo/site";
import { SiteCard } from "./site-card";

const size = { width: OG_WIDTH, height: OG_HEIGHT };
/** 같은 주소(번호·데이터 버전이 주소에 들어 있다)는 같은 그림이다. 기본 그림은 곧 다시 시도하게 짧게만 둔다. */
const CACHE_OK = "public, max-age=86400, s-maxage=86400";
const CACHE_FALLBACK = "public, max-age=60";
/**
 * 시간 예산. 링크 그림(서버 응답 받기 + 그리기)은 1.5초, 그게 안 되면 기본 그림 그리기에 0.5초. 둘 다 안 되면 빌드 때 만든
 * 정적 기본 이미지(`/opengraph-image`)로 302 보낸다. 어느 경우에도 500을 내지 않는다(크롤러가 오래 기다려 주지 않고, 깨진 그림보다 기본 그림이 낫다).
 * 링크 HTML을 먼저 스크랩하며 서버가 이미 깨어 있으므로 평소에는 첫 단계에서 끝난다.
 */
const LINK_BUDGET_MS = 1500;
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
async function draw(element: ReactElement, signal: AbortSignal): Promise<ArrayBuffer> {
  const fonts = await ogFonts();
  signal.throwIfAborted();
  return new ImageResponse(element, { ...size, fonts }).arrayBuffer();
}

function png(bytes: ArrayBuffer, cache: string): Response {
  return new Response(bytes, { headers: { "Content-Type": "image/png", "Cache-Control": cache } });
}

/**
 * 링크별 미리보기 그림 응답. `card`는 링크의 그림(서버 응답을 받아 만든 요소)이고, 그릴 것이 없으면(잘못된 링크·서버 실패·오래된 번호) null이다.
 * 그 뒤는 사이트 기본 그림(짧은 캐시), 마지막은 정적 기본 이미지로 302.
 */
export async function ogImageResponse(card: (signal: AbortSignal) => Promise<ReactElement | null>): Promise<Response> {
  try {
    const linked = await withinBudget(LINK_BUDGET_MS, async (signal) => {
      const element = await card(signal);
      signal.throwIfAborted();
      return element ? draw(element, signal) : null;
    });
    if (linked) return png(linked, CACHE_OK);
    const site = await withinBudget(FALLBACK_BUDGET_MS, (signal) => draw(<SiteCard />, signal));
    if (site) return png(site, CACHE_FALLBACK);
  } catch {
    // 아래 정적 이미지로 간다.
  }
  return new Response(null, {
    status: 302,
    headers: { Location: absoluteUrl("/opengraph-image"), "Cache-Control": CACHE_FALLBACK },
  });
}
