/**
 * 공유 링크(`/s?...`)의 결과 불러오기: 미리보기 제목·설명·그림 값은 `lib/share-card`가 만들고, 여기서는 서버에서 결과를 받아 화면 값으로 바꾼다.
 */
import { cache } from "react";
import { recommend } from "@/lib/api/client";
import type { Mode, RecommendResult } from "@/lib/api/types";
import type { ShareState } from "@/lib/link/codec";
import { type ResultView, toResultView } from "@/lib/result/view-model";
import { DEFAULT_SLOT, type TimeSlot } from "@/lib/when/time-slot";

/** 크롤러(카카오·슬랙 등)가 오래 기다려 주지 않는다. 서버가 깨는 중이면 기본 미리보기로 간다. */
const RECOMMEND_TIMEOUT_MS = 3000;

/**
 * `cache`가 인자 값으로 같은 요청을 알아보게 별칭 목록은 JSON 문자열로 받는다. `signal`은 부른 쪽의 중단 신호(`/s/og`의 시간 예산)이며
 * 자체 제한 시간과 함께 건다. 신호가 다르면 다른 호출로 본다(페이지 메타데이터처럼 신호 없이 부르는 곳끼리만 한 번으로 묶인다).
 */
async function fetchResult(
  origins: string,
  mode: Mode,
  favorIndex: number | null,
  nicknamesJson: string,
  timeSlot: TimeSlot,
  slotDefaulted: boolean,
  signal: AbortSignal | undefined,
): Promise<RecommendResult | null> {
  try {
    const nicknames = JSON.parse(nicknamesJson) as ShareState["nicknames"];
    const timeout = AbortSignal.timeout(RECOMMEND_TIMEOUT_MS);
    return await recommend(
      // 옛 링크(v=1)는 구분을 고른 적이 없다: 결과 화면과 같이 구분 없이 요청한다(막차 시각이 미리보기에 실리지 않게).
      {
        origins: origins.split("."),
        mode,
        favorIndex,
        nicknames,
        timeSlot,
        ...(slotDefaulted ? { slotDefaulted } : {}),
      },
      signal ? AbortSignal.any([timeout, signal]) : timeout,
      "preview",
    );
  } catch {
    return null;
  }
}

const fetchResultOnce = cache(fetchResult);

/**
 * 결과를 받아 화면 값으로. 서버가 느리거나 실패하거나 `signal`로 중단되면 null(호출한 쪽이 기본 미리보기로 대체). 한 요청 안에서는 한 번만 부른다.
 * 링크의 구분과 다른 기준으로 계산된 결과(서버가 구분 행렬을 못 써 평일 낮으로 대신 계산)도 null이다: 메신저가 미리보기를 오래 캐시하므로
 * 틀린 기준의 제목·설명·그림을 남기지 않고 기본 미리보기(짧은 캐시)로 간다.
 */
export async function loadSharedView(state: ShareState, signal?: AbortSignal): Promise<ResultView | null> {
  const result = await fetchResultOnce(
    state.origins.join("."),
    state.mode,
    state.favorIndex,
    JSON.stringify(state.nicknames),
    state.timeSlot,
    state.slotDefaulted === true,
    signal,
  );
  if (!result) return null;
  const used = (result.timeBasis as RecommendResult["timeBasis"] | undefined)?.timeSlot ?? DEFAULT_SLOT;
  return used === state.timeSlot ? toResultView(result) : null;
}
