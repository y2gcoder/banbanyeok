/**
 * 공유 링크(`/s?...`)의 미리보기: 제목·설명(`generateMetadata`)과 이미지 데이터(`/s/og`)가 같은 문구를 쓰게 한 곳에서 만든다.
 * 제목은 제안하는 말투("{1위역}에서 볼까?"), 설명은 각자 시간("민수 34분 · 홍대입구에서 오는 분 38분 · 공평하게 고름",
 * product-ux 4.4). 이름은 서버 label이다.
 */
import { cache } from "react";
import { recommend } from "@/lib/api/client";
import type { Mode, RecommendResult } from "@/lib/api/types";
import { formatMinutes } from "@/lib/display/minutes";
import { encodeShareQuery, type ShareState } from "@/lib/link/codec";
import { type ResultView, toResultView } from "@/lib/result/view-model";
import { ogSafeName } from "./og-coverage";
import { OG_TEXT } from "./og-text";

/** 크롤러(카카오·슬랙 등)가 오래 기다려 주지 않는다. 서버가 깨는 중이면 기본 미리보기로 간다. */
const RECOMMEND_TIMEOUT_MS = 3000;

const SHARED_OG_PATH = "/s/og";

/** "공평하게 고름" / "가장 빠른 만남으로 고름" / "{이름} 쪽으로 고름". */
export function modeSentence(mode: Mode, favorName: string | null): string {
  switch (mode) {
    case "fair":
      return OG_TEXT.modeFair;
    case "fast":
      return OG_TEXT.modeFast;
    case "favor":
      return `${favorName ?? ""}${OG_TEXT.modeFavorSuffix}`.trim();
  }
}

function favorName(view: ResultView, state: ShareState): string | null {
  return state.favorIndex === null ? null : (view.people[state.favorIndex]?.name ?? null);
}

export type SharedPreview = { title: string; description: string };

export function sharedPreview(view: ResultView, state: ShareState): SharedPreview | null {
  const top = view.candidates[0];
  if (!top) return null;
  const times = top.people.map((p) => `${p.name} ${formatMinutes(p.minutes)}`).join(" · ");
  return {
    title: `${top.stationName}${OG_TEXT.sharedSuffix}`,
    description: `${times} · ${modeSentence(view.mode, favorName(view, state))}`,
  };
}

/**
 * 이미지에 그릴 값. 이름은 서버 label이고, 글꼴에 없는 글자는 거른다(`ogSafeName`). 이모지만으로 된 별칭처럼 남는 글자가 없으면
 * 순번("참가자 N")으로 그린다(시점 표현 "나/친구1"은 쓰지 않는다).
 */
export function sharedCardData(view: ResultView, state: ShareState) {
  const top = view.candidates[0];
  if (!top) return null;
  const safe = (name: string, index: number) => ogSafeName(name, `참가자 ${index + 1}`);
  return {
    stationName: top.stationName,
    people: top.people.map((p, index) => ({ name: safe(p.name, index), minutes: p.minutes })),
    modeLine: modeSentence(
      view.mode,
      state.favorIndex === null ? null : safe(view.people[state.favorIndex]?.name ?? "", state.favorIndex),
    ),
  };
}

/** `og:image` 주소. 데이터 버전을 붙여, 새 데이터가 나오면 주소가 바뀌어 크롤러 캐시를 비켜 간다. */
export function sharedImagePath(state: ShareState, dataVersion: string): string {
  return `${SHARED_OG_PATH}?${encodeShareQuery(state)}&dv=${encodeURIComponent(dataVersion)}`;
}

/** `cache`가 인자 값으로 같은 요청을 알아보게 별칭 목록은 JSON 문자열로 받는다. */
async function fetchResult(
  origins: string,
  mode: Mode,
  favorIndex: number | null,
  nicknamesJson: string,
): Promise<RecommendResult | null> {
  try {
    const nicknames = JSON.parse(nicknamesJson) as ShareState["nicknames"];
    return await recommend(
      { origins: origins.split("."), mode, favorIndex, nicknames },
      AbortSignal.timeout(RECOMMEND_TIMEOUT_MS),
    );
  } catch {
    return null;
  }
}

const fetchResultOnce = cache(fetchResult);

/** 결과를 받아 화면 값으로. 서버가 느리거나 실패하면 null(호출한 쪽이 기본 미리보기로 대체). 한 요청 안에서는 한 번만 부른다. */
export async function loadSharedView(state: ShareState): Promise<ResultView | null> {
  const result = await fetchResultOnce(
    state.origins.join("."),
    state.mode,
    state.favorIndex,
    JSON.stringify(state.nicknames),
  );
  return result ? toResultView(result) : null;
}
