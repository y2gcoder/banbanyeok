/**
 * 서버 결과(Result)를 화면용 값으로 바꾼다. 계산(순위)은 하지 않고 표시 규칙만 적용한다.
 * 사람 이름은 서버가 만든 `participants[].label`·`shortLabel`을 그대로 쓴다(contracts/data-format.md §8). 웹은 이름 규칙을 다시 만들지 않는다.
 * `label`(name)은 문장에, `shortLabel`(shortName)은 좁은 칸(시간 행·알약·미리보기·공유 문구의 시간 나열)에 쓴다.
 */
import type { Mode, RecommendResult } from "@/lib/api/types";
import { type DisplayAggregate, displayAggregate, minutesFromSeconds } from "@/lib/display/minutes";
import { evaluateNotices, type Notice } from "@/lib/display/notices";
import { kakaoPlaceUrl, kakaoTransitUrl } from "@/lib/map/kakao";
import { stationByCode } from "@/lib/stations";
import { type LastTrainView, type MeetingWhen, recalculatingLastTrainView, toLastTrainView } from "./last-train";
import { type MapMiddleView, toMapMiddleView } from "./map-middle";

type PersonView = {
  index: number;
  /** 서버가 만든 표시 이름(label). "(나)" 같은 보는 사람 표시는 화면이 따로 붙인다. */
  name: string;
  /** 서버가 만든 짧은 이름(shortLabel). 출발역이면 "홍대입구", 그 밖에는 name과 같다. */
  shortName: string;
  labelKind: RecommendResult["participants"][number]["labelKind"];
  originName: string | null;
  originCode: string | null;
};

export type PersonTimeView = PersonView & {
  seconds: number;
  minutes: number;
  transfers: number;
  /** 카카오맵 대중교통 길찾기(출발역 → 만날 역). 좌표를 모르면 null. */
  directionsUrl: string | null;
};

export type CandidateView = {
  rank: number;
  stationCode: string;
  stationName: string;
  lines: string[];
  reason: string;
  reasonCode: string;
  people: PersonTimeView[];
  aggregate: DisplayAggregate;
  placeUrl: string | null;
  /** "집에 가는 막차" 칸(#62). 서버가 막차를 주지 않았거나 이 화면이 보이지 않기로 했으면 null. */
  lastTrain: LastTrainView | null;
};

export type ResultViewOptions = {
  /**
   * false면 막차 칸을 만들지 않는다. 옛 링크(v=1)는 요일을 고른 적이 없어 서버가 시각을 주지 않으므로(`day_unknown`) 칸 자체를 뺀다.
   * "recalculating"이면 막차를 줄 응답의 칸마다 줄 없이 "다시 계산하는 중"만 보인다: 방이 바뀌어 이 결과가 지금 방의 것이 아닐 때
   * (방 화면이 방과 결과의 공유 번호를 견줘 정한다). 기본은 true.
   */
  lastTrains?: boolean | "recalculating";
  /** 방의 약속 날짜·시각. 있으면 막차 칸이 약속보다 먼저 떠나는 열차를 가려낸다(새벽 약속). 혼자 입력한 결과에는 없다. */
  meeting?: MeetingWhen;
};

export type ResultView = {
  mode: Mode;
  status: RecommendResult["status"];
  dataVersion: string;
  people: PersonView[];
  candidates: CandidateView[];
  notices: Notice[];
  /** 계산 기준(실제로 쓴 구분과 화면 문구). */
  timeBasis: RecommendResult["timeBasis"];
  /** "지도 한가운데였다면?" 비교. 보여 줄 조건을 모두 만족할 때만 있다(`toMapMiddleView`). 옛 서버·방 결과에는 없다. */
  mapMiddle: MapMiddleView | null;
  /**
   * 서버가 막 떠서 막차 표를 아직 읽는 중이라 막차가 빠졌다(`lastTrainPending`). 잠시 뒤 같은 요청에는 막차가 붙을 수 있으므로,
   * 이 값으로 만든 공유 그림은 오래 캐시하지 않는다(`/s/og`).
   */
  lastTrainPending: boolean;
};

function place(code: string | null, name: string | null) {
  if (!code || !name) return null;
  const geo = stationByCode(code)?.geo;
  return geo ? { name: name.endsWith("역") ? name : `${name}역`, ...geo } : null;
}

export function toResultView(result: RecommendResult, options: ResultViewOptions = {}): ResultView {
  const showLastTrains = options.lastTrains !== false;
  const people: PersonView[] = result.participants.map((p, index) => ({
    index,
    name: p.label,
    // shortLabel을 모르는 옛 서버(웹이 먼저 배포된 사이)는 보내지 않는다. 그동안은 label로 그린다.
    shortName: (p.shortLabel as string | undefined) ?? p.label,
    labelKind: p.labelKind,
    originName: p.originName ?? null,
    originCode: p.originCode ?? null,
  }));
  const candidates = result.candidates.map((c): CandidateView => {
    const destination = place(c.stationCode, c.stationName);
    const timed = people.map((person, i): PersonTimeView => {
      const time = c.times[i];
      const from = place(person.originCode, person.originName);
      return {
        ...person,
        seconds: time?.seconds ?? 0,
        minutes: minutesFromSeconds(time?.seconds ?? 0),
        transfers: time?.transfers ?? 0,
        directionsUrl: from && destination ? kakaoTransitUrl(from, destination) : null,
      };
    });
    // 막차는 돌아가는 길이다: 길찾기는 만날 역 → 각자의 출발역 방향으로 연다.
    const lastTrain = !showLastTrains
      ? null
      : options.lastTrains === "recalculating"
        ? result.lastTrainBasis && c.lastTrains
          ? recalculatingLastTrainView({ name: c.stationName })
          : null
        : toLastTrainView(
            result.lastTrainBasis,
            c.lastTrains,
            { code: c.stationCode, name: c.stationName },
            people.map((person, i) => {
              const participant = result.participants[i];
              const home = place(person.originCode, person.originName);
              return {
                index: person.index,
                participantId: participant?.participantId ?? "",
                shortName: person.shortName,
                hidden: participant?.hidden === true,
                isSelf: participant?.isSelf === true,
                originCode: person.originCode,
                mapUrl: home && destination ? kakaoTransitUrl(destination, home) : null,
              };
            }),
            options.meeting,
          );
    return {
      rank: c.rank,
      stationCode: c.stationCode,
      stationName: c.stationName,
      lines: stationByCode(c.stationCode)?.lines ?? [],
      reason: c.reason,
      reasonCode: c.reasonCode,
      people: timed,
      aggregate: displayAggregate(timed.map((t) => t.seconds)),
      placeUrl: destination ? kakaoPlaceUrl(destination) : null,
      lastTrain,
    };
  });
  const first = candidates[0];
  const notices = evaluateNotices({
    mode: result.mode,
    names: people.map((p) => p.name),
    originCodes: people.map((p) => p.originCode),
    candidates: candidates.map((c) => ({ stationName: c.stationName, seconds: c.people.map((p) => p.seconds) })),
  });
  return {
    mode: result.mode,
    status: result.status,
    dataVersion: result.dataVersion,
    people,
    candidates,
    notices,
    timeBasis: result.timeBasis,
    mapMiddle: first
      ? toMapMiddleView(result, { stationCode: first.stationCode, minutes: first.aggregate.minutes })
      : null,
    lastTrainPending: result.lastTrainPending === true,
  };
}
