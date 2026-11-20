import { createHash } from "node:crypto";
import { PAIR_OG_IMAGE_VERSION } from "@/lib/copy/og-text";
import type { PairPage } from "./pair-pages";

/** 그림(`PairCard`)에 그려지는 조합 데이터만. 이유 문장처럼 그림에 안 나오는 값이 바뀌어도 주소는 그대로여야 한다. */
function drawnData(page: PairPage) {
  return [
    page.first.name,
    page.second.name,
    page.candidates.map((candidate) => [
      candidate.rank,
      candidate.station.name,
      candidate.people.map((person) => [person.stationName, person.minutes]),
    ]),
  ];
}

/**
 * 이 조합 페이지의 미리보기 그림 주소: `/meet/<코드>-<코드>/opengraph-image?v=<8자리>`.
 * `v`는 그림의 고정 부분 버전과 이 조합의 그려지는 데이터에서 만든다. 문구·색·글꼴·그리는 코드가 바뀌거나 산출물 데이터가 바뀌어
 * 이 조합의 그림이 달라질 때만 바뀐다(카카오가 그림을 주소별로 오래 캐시하므로 주소가 같으면 옛 그림이 나간다).
 */
export function pairOgImagePath(page: PairPage): string {
  const digest = createHash("sha256")
    .update(PAIR_OG_IMAGE_VERSION)
    .update(JSON.stringify(drawnData(page)));
  return `${page.path}/opengraph-image?v=${digest.digest("hex").slice(0, 8)}`;
}
