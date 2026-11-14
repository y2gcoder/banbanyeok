/**
 * 극단 상황 안내. shared/app-logic `SituationAdvisor`(docs/setup/p6-notes.md 4.3)와 같은 조건·문구다.
 * 서버 응답의 초 값으로 판단하고, "비슷한 후보" 비교만 표시 분으로 한다.
 */
import type { Mode } from "@/lib/api/types";
import { stationLabel } from "./korean";
import { minutesFromSeconds } from "./minutes";

const LONG_TRAVEL_SECONDS = 90 * 60;
const NEARBY_SECONDS = 5 * 60;
const SIMILAR_WITHIN_MINUTES = 2;

type NoticeKind = "NO_COMMON_CANDIDATE" | "SAME_NEIGHBORHOOD" | "LONG_TRAVEL" | "SIMILAR_CANDIDATES";

export type Notice = {
  kind: NoticeKind;
  text: string;
  /** "○○ 쪽으로 보기" 버튼이 가리킬 사람. 없으면 버튼 없음. */
  cta: { favorIndex: number; label: string } | null;
};

export type SituationInput = {
  mode: Mode;
  /** 표시 이름(입력 순서). */
  names: readonly string[];
  /** 출발역 코드. 숨긴 사람은 null. */
  originCodes: readonly (string | null)[];
  /** 순위순 후보. 각 후보의 사람별 초(입력 순서). */
  candidates: readonly { stationName: string; seconds: readonly number[] }[];
};

function similarNotice(input: SituationInput): Notice | null {
  if (input.candidates.length < 2 || input.mode === "favor") return null;
  const metric = input.candidates.map(({ seconds }) => {
    const minutes = seconds.map(minutesFromSeconds);
    return input.mode === "fair" ? Math.max(...minutes) : minutes.reduce((a, b) => a + b, 0);
  });
  const first = metric[0] ?? 0;
  if (metric.some((value) => Math.abs(value - first) > SIMILAR_WITHIN_MINUTES)) return null;
  const count = input.candidates.length === 2 ? "두" : "세";
  return { kind: "SIMILAR_CANDIDATES", text: `${count} 곳 다 비슷해요. 가고 싶은 동네로 고르세요.`, cta: null };
}

/** 해당하는 안내를 우선순위 순으로 돌려준다. */
export function evaluateNotices(input: SituationInput): Notice[] {
  const top = input.candidates[0];
  if (!top) {
    return [
      { kind: "NO_COMMON_CANDIDATE", text: "모두가 갈 수 있는 역을 찾지 못했어요. 출발역을 바꿔 보세요.", cta: null },
    ];
  }
  const topMax = Math.max(...top.seconds);
  const codes = input.originCodes;
  const allSameOrigin = codes.every((code) => code !== null) && new Set(codes).size === 1;
  if (allSameOrigin || topMax <= NEARBY_SECONDS) {
    return [
      {
        kind: "SAME_NEIGHBORHOOD",
        text: `이미 같은 동네예요. ${stationLabel(top.stationName)}에서 만나세요.`,
        cta: null,
      },
    ];
  }
  const notices: Notice[] = [];
  if (topMax > LONG_TRAVEL_SECONDS) {
    const text = "누군가는 90분 넘게 걸려요. 한쪽 동네에서 만나는 게 나을 수도 있어요.";
    const longest = top.seconds.indexOf(topMax);
    const cta =
      input.mode === "favor" ? null : { favorIndex: longest, label: `${input.names[longest] ?? ""} 쪽으로 보기` };
    notices.push({ kind: "LONG_TRAVEL", text, cta });
  }
  const similar = similarNotice(input);
  if (similar) notices.push(similar);
  return notices;
}
