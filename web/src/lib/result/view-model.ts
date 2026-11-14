/**
 * 서버 결과(Result)를 화면용 값으로 바꾼다. 계산(순위)은 하지 않고 표시 규칙만 적용한다.
 * 사람 이름은 서버가 만든 `participants[].label`을 그대로 쓴다(contracts/data-format.md §8). 웹은 이름 규칙을 다시 만들지 않는다.
 */
import type { Mode, RecommendResult } from "@/lib/api/types";
import { type DisplayAggregate, displayAggregate, minutesFromSeconds } from "@/lib/display/minutes";
import { evaluateNotices, type Notice } from "@/lib/display/notices";
import { kakaoPlaceUrl, kakaoTransitUrl } from "@/lib/map/kakao";
import { stationByCode } from "@/lib/stations";

type PersonView = {
  index: number;
  /** 서버가 만든 표시 이름(label). "(나)" 같은 보는 사람 표시는 화면이 따로 붙인다. */
  name: string;
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
};

export type ResultView = {
  mode: Mode;
  status: RecommendResult["status"];
  dataVersion: string;
  people: PersonView[];
  candidates: CandidateView[];
  notices: Notice[];
};

function place(code: string | null, name: string | null) {
  if (!code || !name) return null;
  const geo = stationByCode(code)?.geo;
  return geo ? { name: name.endsWith("역") ? name : `${name}역`, ...geo } : null;
}

export function toResultView(result: RecommendResult): ResultView {
  const people: PersonView[] = result.participants.map((p, index) => ({
    index,
    name: p.label,
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
    };
  });
  const notices = evaluateNotices({
    mode: result.mode,
    names: people.map((p) => p.name),
    originCodes: people.map((p) => p.originCode),
    candidates: candidates.map((c) => ({ stationName: c.stationName, seconds: c.people.map((p) => p.seconds) })),
  });
  return { mode: result.mode, status: result.status, dataVersion: result.dataVersion, people, candidates, notices };
}
