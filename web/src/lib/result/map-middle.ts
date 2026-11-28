/**
 * "지도 한가운데였다면?" 비교(#68)의 화면 규칙. 지도 한가운데 역과 각자 시간은 서버가 계산해 `Result.mapMiddle`로 준다(조건은
 * contracts/openapi.yaml). 웹은 계산하지 않고, 받은 값을 **한 번 더 걸러** 보여 줄 때만 화면 값(`MapMiddleView`)으로 바꾼다:
 * 서버가 조건을 어긴 값을 보내거나(옛 서버·버그) 화면 숫자와 어긋나는 값이 와도 거짓 비교를 그리지 않는다.
 *
 * 이 파일은 공유 그림(`/s/og`), 방 미리보기(`/r/<id>/og`·설명), 결과 화면이 같은 문장·같은 칭호 규칙을 쓰게 하는 곳이다.
 */
import type { RecommendResult } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/copy/og-text";
import { stationLabel, withJosa } from "@/lib/display/korean";
import { formatMinutes, minutesFromSeconds } from "@/lib/display/minutes";

/**
 * 지도 한가운데 역의 가장 오래 걸리는 시간이 추천 역보다 이만큼(분) 이상 길 때만 보인다. 서버 규칙(`MapMiddleRule`)과 같은 값이어야
 * 하고 contracts/golden/display-minutes.json의 `mapMiddle`로 둘 다 검사한다.
 */
export const MIDDLE_MIN_EXTRA = 5;

/** 이름이 이보다 길면 문장에서 "가장 오래 걸리는 사람"으로 부른다(말풍선에서 긴 별칭이 잘리면 어색하다). */
const MIDDLE_NAME_MAX = 6;

export type MapMiddleView = {
  stationCode: string;
  stationName: string;
  /** 사람별 표시 분(입력 순서). */
  minutes: number[];
  /** 가장 오래(각 역에서 가장 오래 걸리는 사람의 분). 공평 기준이 이 값을 줄이는 것이라 "차이"보다 비교에 맞다. */
  max: number;
  /** 지도 한가운데 역에서 가장 오래 걸리는 사람(입력 순서). 같으면 추천 역보다 더 늘어난 사람. */
  personIndex: number;
  /** 그 사람이 추천 역보다 더 걸리는 분. */
  extra: number;
};

/**
 * 공평 기준으로 서버가 비교 값을 응답에 실었을 때만 계산한다.
 * `top.minutes`는 1위 추천 역의 사람별 표시 분이다(입력 순서).
 */
export function toMapMiddleView(
  result: Pick<RecommendResult, "mode" | "mapMiddle">,
  top: { stationCode: string; minutes: readonly number[] },
): MapMiddleView | null {
  const middle = result.mapMiddle;
  if (result.mode !== "fair" || !middle) return null;
  return middleView(middle, top);
}

/**
 * 서버가 준 지도 한가운데 값(무상태 `Result.mapMiddle`이든 방 미리보기 `RoomPreviewResult.mapMiddle`이든 같은 모양의 시간)을 화면 값으로.
 * 숨기는 경우: 추천 역과 같은 역이다 · 사람 수가 맞지 않는다 · 가장 오래 걸리는 시간이 `MIDDLE_MIN_EXTRA`분보다 적게 늘었다.
 * 공평 기준인지는 부르는 쪽이 먼저 본다.
 */
export function middleView(
  middle: { stationCode: string; stationName: string; times: readonly { seconds: number }[] },
  top: { stationCode: string; minutes: readonly number[] },
): MapMiddleView | null {
  if (middle.stationCode === top.stationCode || middle.times.length !== top.minutes.length) return null;
  const minutes = middle.times.map((t) => minutesFromSeconds(t.seconds));
  const max = Math.max(...minutes);
  if (max - Math.max(...top.minutes) < MIDDLE_MIN_EXTRA) return null;
  // 지도 한가운데 역에서 가장 오래 걸리는 사람. 같으면 더 많이 늘어난 사람(앞선 사람이 먼저).
  const growth = (i: number) => (minutes[i] ?? 0) - (top.minutes[i] ?? 0);
  let personIndex = 0;
  for (let i = 1; i < minutes.length; i += 1) {
    const a = minutes[i] ?? 0;
    const b = minutes[personIndex] ?? 0;
    if (a > b || (a === b && growth(i) > growth(personIndex))) personIndex = i;
  }
  return {
    stationCode: middle.stationCode,
    stationName: middle.stationName,
    minutes,
    max,
    personIndex,
    extra: growth(personIndex),
  };
}

/** 차이가 아주 작을 때의 칭호. 2명은 1분 이하, 3~4명은 2분 이하. 공평 기준에서만 붙인다(그 밖의 기준은 "반반"을 말하지 않는다). */
export function evenTitle(mode: RecommendResult["mode"], spread: number, people: number): string | null {
  if (mode !== "fair") return null;
  return spread <= (people <= 2 ? 1 : 2) ? OG_TEXT.evenTitle : null;
}

/**
 * "지도 한가운데인 한강진역이면 잠실은 14분 더 걸려요". 사실(시간)만 말하고 제안하는 말투다.
 * `name`이 `MIDDLE_NAME_MAX`자를 넘으면 "가장 오래 걸리는 사람은"으로 쓴다.
 */
export function middleSentence(middle: Pick<MapMiddleView, "stationName" | "extra">, name: string): string {
  const who = Array.from(name).length > MIDDLE_NAME_MAX ? OG_TEXT.middleLongest : name;
  return `${OG_TEXT.middleLead}${stationLabel(middle.stationName)}${OG_TEXT.middleIf}${withJosa(who, "은/는")} ${formatMinutes(middle.extra)}${OG_TEXT.middleMore}`;
}

/**
 * 화면 값(`ResultView`)의 비교 문장. 비교를 보일 조건을 채우지 못하면 null이다. 이름은 서버 짧은 이름이고 `name`으로 바꿔 쓸 수 있다
 * (그림은 글꼴에 있는 글자로 거른 이름을 쓴다).
 */
export function mapMiddleSentence(
  view: { mapMiddle: MapMiddleView | null; people: readonly { shortName: string }[] },
  name?: string,
): string | null {
  const middle = view.mapMiddle;
  if (!middle) return null;
  return middleSentence(middle, name ?? view.people[middle.personIndex]?.shortName ?? "");
}
