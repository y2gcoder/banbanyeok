/**
 * 공유 링크(`/s?...`)의 미리보기: 제목·설명(`generateMetadata`)과 이미지 데이터(`/s/og`)가 같은 문구를 쓰게 한 곳에서 만든다.
 * 제목은 제안하는 말투("{1위역}에서 볼까?"), 설명은 각자 시간("민수 34분 · 홍대입구 38분 · 공평하게 고름", product-ux 4.4).
 * 이름은 서버 짧은 이름(shortLabel)이다: 미리보기는 좁은 칸이라 "홍대입구에서 오는 분" 대신 "홍대입구"(V1).
 */
import { ogSafeName } from "@/lib/copy/og-coverage";
import { OG_TEXT } from "@/lib/copy/og-text";
import { formatMinutes } from "@/lib/display/minutes";
import type { ShareState } from "@/lib/link/codec";
import type { BanbanLine } from "@/lib/result/banban-index";
import { type LastTrainView, lastTrainCardLine } from "@/lib/result/last-train";
import { mapMiddleSentence } from "@/lib/result/map-middle";
import { modeSentence } from "@/lib/result/mode-sentence";
import type { ResultView } from "@/lib/result/view-model";
import { DEFAULT_SLOT } from "@/lib/when/time-slot";

/** 평일 낮이 아닌 기준이면 "토요일 저녁 기준"(시간이 그 기준이라서). 평일 낮은 null이다(옛 링크와 같은 문구). */
export function basisText(view: ResultView): string | null {
  const basis = view.timeBasis as ResultView["timeBasis"] | undefined; // 구분을 모르는 옛 서버는 보내지 않는다
  return !basis || basis.timeSlot === DEFAULT_SLOT ? null : `${basis.label}${OG_TEXT.basisSuffix}`;
}

/** 설명·그림 기준 줄 뒤에 붙는 " · 토요일 저녁 기준". */
function basisSuffix(view: ResultView): string {
  const text = basisText(view);
  return text === null ? "" : ` ${OG_TEXT.middleDot} ${text}`;
}

function favorName(view: ResultView, state: ShareState): string | null {
  return state.favorIndex === null ? null : (view.people[state.favorIndex]?.shortName ?? null);
}

/** 공유 링크 그림(`SharedCard`)에 넘기는 값. */
export type SharedCardData = {
  /** 만날 역 코드. 참가자 출발역 코드는 그림에 전달하지 않는다. */
  stationCode?: string;
  stationName: string;
  /** 역 이름 아래 큰 줄. 없으면 "에서 볼까?"(방에서 정한 역은 "에서 만나요"). */
  suffix?: string;
  /**
   * 입력 순서. 이름은 서버 짧은 이름(shortLabel)을 글꼴에 있는 글자만으로 정리한 값(`ogSafeName`)이다. 출발역을 숨긴 사람은 서버가
   * "참가자 N"으로 주므로 숨긴 출발역은 그림에 나올 수 없다. `favored`는 "누구 쪽으로"에서 고른 사람. `minutes`가 null이면 그 역까지 갈 수 없다.
   */
  people: {
    name: string;
    minutes: number | null;
    favored: boolean;
    /**
     * 시간 아래의 작은 줄 "막차 00:03" / "늦어도 23:00"(#62). 시각을 모르면(확인 필요) 키가 없다. 출발역을 숨긴 사람에게는
     * 늘 없다(미리보기는 누가 보든 같은 그림이다).
     */
    lastTrain?: string;
  }[];
  /** "공평하게 고름" 같은 기준 한 마디(+ " · 토요일 밤 기준"). */
  modeLine: string;
  /** 왼쪽 아래 두 줄을 직접 정한다(방에서 정한 역: "민수가 정했어요" / "11월 21일 (토) 저녁"). 없으면 최장·차이·기준. */
  footer?: { main: string; sub: string };
  /**
   * 방 미리보기의 "지도 한가운데였다면" 비교 문장(#68 2단계). 왼쪽 아래 맨 끝 줄에 둔다. 서버는 출발역을 숨긴 사람이 있으면 값을 주지
   * 않으므로 숨긴 사람이 있는 방에는 이 줄이 없다. 무상태 링크는 숫자판(`ScoreboardCard`)의 `compareLine`을 쓴다.
   */
  middleLine?: string;
  /** 결과를 숨긴 그림(뽑기 방에서 뽑은 뒤, #172): 이름 옆 시간·노선 강조·역 배지를 그리지 않고 고리 안에 "?"를 둔다. */
  teaser?: boolean;
  /**
   * 반반지수(#202). 방 미리보기의 1위 단계에서 공평하게일 때만 있다. 있으면 노선 그림 대신 사람별 막대를 그리고, 왼쪽 아래 큰 줄이
   * 이 한 줄, 작은 줄이 기준 한 마디다(차이는 막대가 보여 준다).
   */
  banban?: BanbanLine | null;
};

export type SharedPreview = { title: string; description: string };

export function sharedPreview(view: ResultView, state: ShareState): SharedPreview | null {
  const top = view.candidates[0];
  if (!top) return null;
  const times = top.people.map((p) => `${p.shortName} ${formatMinutes(p.minutes)}`).join(" · ");
  const middle = mapMiddleSentence(view);
  return {
    title: `${top.stationName}${OG_TEXT.sharedSuffix}`,
    description: `${times} · ${modeSentence(view.mode, favorName(view, state))}${basisSuffix(view)}${middle ? ` ${OG_TEXT.middleDot} ${middle}` : ""}`,
  };
}

/** 그림에 넣는 막차 줄. 그 사람의 줄에 시각이 있고, 본인에게만 보이는 줄(출발역을 숨긴 본인)이 아닐 때만. */
function cardLastTrain(lastTrain: LastTrainView | null, index: number): string | null {
  const row = lastTrain?.rows.find((r) => r.index === index);
  if (!row || row.onlyMe || (row.state.kind !== "direct" && row.state.kind !== "margin")) return null;
  return lastTrainCardLine(row.state, OG_TEXT);
}

/**
 * 이미지에 그릴 값. 이름은 서버 짧은 이름이고, 글꼴에 없는 글자는 거른다(`ogSafeName`). 이모지만으로 된 별칭처럼 남는 글자가 없으면
 * 순번("참가자 N")으로 그린다(시점 표현 "나/친구1"은 쓰지 않는다).
 */
export function sharedCardData(view: ResultView, state: ShareState): SharedCardData | null {
  const top = view.candidates[0];
  if (!top) return null;
  const safe = (name: string, index: number) => ogSafeName(name, `참가자 ${index + 1}`);
  const favored = view.mode === "favor" ? state.favorIndex : null;
  return {
    stationCode: top.stationCode,
    stationName: top.stationName,
    people: top.people.map((p, index) => {
      const lastTrain = cardLastTrain(top.lastTrain, index);
      return {
        name: safe(p.shortName, index),
        minutes: p.minutes,
        favored: index === favored,
        ...(lastTrain ? { lastTrain } : {}),
      };
    }),
    modeLine:
      modeSentence(view.mode, favored === null ? null : safe(view.people[favored]?.shortName ?? "", favored)) +
      basisSuffix(view),
  };
}
