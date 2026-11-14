/**
 * 사전 계산된 조합 → 페이지 모델. 순위는 파일 순서 그대로이며 웹은 다시 계산하지 않는다.
 *
 * URL: `/meet/<코드>-<코드>`. 두 역 코드를 사전순(작은 쪽이 앞, 파일의 a<b와 같은 규칙)으로 놓아 A-B와 B-A를 한 주소로 모은다.
 * 반대 순서(B-A) 주소는 만들지 않는다(404). 우리가 만드는 모든 링크·사이트맵·canonical이 정규 주소뿐이고, 리다이렉트 수백 개는
 * Worker에 규칙으로 실려(요청마다 정규식 검사) 얻는 것이 없다.
 * 역 이름이 아니라 코드를 쓰는 근거는 docs/setup/p5-notes.md 2절(OpenNext/Workers에서 비ASCII 경로의 SSG 페이지가 404로 실측됨,
 * 코드는 개명에도 안 바뀜). 화면에 보이는 역 이름 순서는 가나다 순이다(주소 순서와 다를 수 있다).
 */
import { stationLabel } from "@/lib/display/korean";
import { type DisplayAggregate, displayAggregate, minutesFromSeconds } from "@/lib/display/minutes";
import { type Station, stationByCode } from "@/lib/stations";
import { MAX_RESULTS_PER_PAIR, type SeoPair, type SeoPairsFile } from "./pairs";

export const PAIR_PATH_PREFIX = "/meet";
/** 코드 두 개를 잇는 글자(코드는 [0-9a-z]뿐이라 겹치지 않는다). */
const PAIR_SEPARATOR = "-";

/** 얇은 페이지가 대량으로 생기지 않게 거르는 기준(근거: docs/setup/p5-notes.md 2절). */
export const MEANINGFUL = {
  /** 고를 거리가 있으려면 후보가 둘 이상. */
  minResults: 2,
  /** 1위 최장이 5분 이하면 "이미 같은 동네"라 만날 곳을 고를 이유가 없다(SituationAdvisor와 같은 기준). */
  minTopSeconds: 300,
  /** 1위 최장이 90분을 넘으면 "한쪽 동네에서 만나라"가 답이라 조합 페이지로 의미가 약하다. */
  maxTopSeconds: 5400,
} as const;

export type StationRef = { code: string; name: string; label: string; lines: string[] };

type PairPerson = { stationName: string; seconds: number; minutes: number; transfers: number };

export type PairCandidate = {
  rank: number;
  station: StationRef;
  /** 입력 순서가 아니라 페이지의 a, b 순서(= 표시 순서). */
  people: [PairPerson, PairPerson];
  aggregate: DisplayAggregate;
  reason: string;
};

export type PairPage = {
  slug: string;
  path: string;
  /** 표시·URL 순서(가나다). 파일의 a<b(코드순)와 다를 수 있다. */
  first: StationRef;
  second: StationRef;
  candidates: PairCandidate[];
};

export type SkippedPair = { a: string; b: string; reason: string };

function ref(station: Station): StationRef {
  return { code: station.code, name: station.name, label: stationLabel(station.name), lines: station.lines };
}

function requireStation(code: string, where: string): Station {
  const station = stationByCode(code);
  if (!station) throw new Error(`역 인덱스에 없는 코드입니다(${where}): ${code}`);
  return station;
}

/** 두 역 코드 → 주소 조각. 사전순 정렬이라 어느 쪽을 먼저 줘도 같다: `("b2c","a1d")` → `"a1d-b2c"`. */
export function pairSlug(x: string, y: string): string {
  const [first, second] = x <= y ? [x, y] : [y, x];
  return `${first}${PAIR_SEPARATOR}${second}`;
}

/** 거를 이유가 있으면 한 줄 설명, 없으면 null. */
export function skipReason(pair: SeoPair): string | null {
  if (pair.results.length < MEANINGFUL.minResults) return `후보가 ${pair.results.length}개뿐`;
  const top = pair.results[0];
  if (!top) return "후보 없음";
  if (top.maxSeconds <= MEANINGFUL.minTopSeconds) return "1위 최장이 5분 이하(같은 동네)";
  if (top.maxSeconds > MEANINGFUL.maxTopSeconds) return "1위 최장이 90분 초과";
  return null;
}

function toPage(pair: SeoPair): PairPage {
  const a = requireStation(pair.a, "a");
  const b = requireStation(pair.b, "b");
  const [first, second] = a.name <= b.name ? [a, b] : [b, a];
  const swapped = first.code !== a.code;
  const slug = pairSlug(a.code, b.code);
  const candidates = pair.results.slice(0, MAX_RESULTS_PER_PAIR).map((result, index): PairCandidate => {
    const station = requireStation(result.stationCode, "result");
    const [secondsA, secondsB] = result.times;
    const [transfersA, transfersB] = result.transfers;
    const person = (name: string, seconds: number, transfers: number): PairPerson => ({
      stationName: name,
      seconds,
      minutes: minutesFromSeconds(seconds),
      transfers,
    });
    const pa = person(a.name, secondsA, transfersA);
    const pb = person(b.name, secondsB, transfersB);
    return {
      rank: index + 1,
      station: ref(station),
      people: swapped ? [pb, pa] : [pa, pb],
      aggregate: displayAggregate([secondsA, secondsB]),
      reason: result.reason,
    };
  });
  return { slug, path: `${PAIR_PATH_PREFIX}/${slug}`, first: ref(first), second: ref(second), candidates };
}

/** 파일에서 만들 페이지와 거른 쌍. 쌍이 중복이면(파일이 약속을 어긴 것) 오류다. */
export function buildPairPages(file: SeoPairsFile): { pages: PairPage[]; skipped: SkippedPair[] } {
  const pages: PairPage[] = [];
  const skipped: SkippedPair[] = [];
  const slugs = new Set<string>();
  for (const pair of file.pairs) {
    const reason = skipReason(pair);
    if (reason) {
      skipped.push({ a: pair.a, b: pair.b, reason });
      continue;
    }
    const page = toPage(pair);
    if (page.first.name === page.second.name) {
      // 같은 이름의 역이 코드만 둘로 나뉜 경우(예: 노선별로 따로 등록된 환승역). 같은 역끼리의 조합 페이지는 의미가 없다.
      skipped.push({ a: pair.a, b: pair.b, reason: "두 역의 이름이 같음" });
      continue;
    }
    if (slugs.has(page.slug)) throw new Error(`주소가 겹칩니다: ${page.slug}`);
    slugs.add(page.slug);
    pages.push(page);
  }
  pages.sort((x, y) => (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  return { pages, skipped };
}

/** Next가 넘기는 `params.pair`로 페이지를 찾는다. */
export function findPairPage(pages: readonly PairPage[], slug: string): PairPage | undefined {
  return pages.find((page) => page.slug === slug);
}

/** 같은 역이 들어간 다른 조합(내부 링크용). 주소순으로 앞에서 `limit`개. */
export function relatedPages(pages: readonly PairPage[], page: PairPage, limit = 6): PairPage[] {
  const names = new Set([page.first.name, page.second.name]);
  return pages
    .filter((p) => p.slug !== page.slug && (names.has(p.first.name) || names.has(p.second.name)))
    .slice(0, limit);
}

/** 허브 목록용: 역마다 그 역이 들어간 조합을 상대 역 이름순으로. 한 조합은 두 역 아래에 한 번씩 나온다. */
export function groupByStation(
  pages: readonly PairPage[],
): { station: StationRef; partners: { page: PairPage; partner: StationRef }[] }[] {
  const groups = new Map<string, { station: StationRef; partners: { page: PairPage; partner: StationRef }[] }>();
  const add = (station: StationRef, partner: StationRef, page: PairPage) => {
    const group = groups.get(station.code) ?? { station, partners: [] };
    group.partners.push({ page, partner });
    groups.set(station.code, group);
  };
  for (const page of pages) {
    add(page.first, page.second, page);
    add(page.second, page.first, page);
  }
  const byName = (a: StationRef, b: StationRef) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return [...groups.values()]
    .map((group) => ({ ...group, partners: group.partners.sort((x, y) => byName(x.partner, y.partner)) }))
    .sort((x, y) => byName(x.station, y.station));
}
