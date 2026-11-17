/**
 * 미리보기(OG) 이미지의 고정 문구·크기·색. 글꼴 서브셋 스크립트(`scripts/build-og-font.ts`)가 이 파일을 읽어
 * 여기 적힌 글자를 서브셋에 반드시 넣는다. 이미지에 쓰는 고정 문구는 **여기에만** 적는다(그래야 빈 네모가 생기지 않는다).
 *
 * 이 파일은 Node가 직접 실행하는 스크립트도 불러오므로 `@/` 별칭과 다른 모듈을 import하지 않는다.
 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** 글꼴 파일은 `public/fonts/`에 둔다(Workers 정적 자산). 서브셋 스크립트가 같은 이름으로 만든다. */
export const OG_FONT_FILE = "og-sans-bold.otf";
export const OG_FONT_FAMILY = "BanbanSans";

/** 사이트 토큰(globals.css)과 같은 값. satori는 CSS 변수를 못 읽어 값으로 적는다. */
export const OG_COLORS = {
  platform: "#eef1f0",
  surface: "#ffffff",
  ink: "#16201b",
  inkSoft: "#3a4640",
  muted: "#56625c",
  rule: "#d3dad7",
  safety: "#f5c518",
  people: ["#1f5bd0", "#e0531c", "#12936a", "#8b4fc4"],
} as const;

export const OG_TEXT = {
  brand: "반반역",
  taglineTop: "우리 어디서 만나야",
  taglineBottom: "덜 억울할까?",
  taglineSub: "각자 지하철 시간으로 계산해요",
  pairQuestion: "어디서 만나면 덜 억울할까?",
  pairBasis: "지하철 시간 기준 · 공평하게 고른 후보 3곳",
  rank: "위",
  minute: "분",
  hour: "시간",
  sharedSuffix: "에서 볼까?",
  /** 방에서 정한 역의 그림 제목 "{역}에서 만나요"와 아래 줄 "민수가 정했어요". 조사(이/가)는 한글 완성형이라 서브셋에 늘 있다. */
  decidedSuffix: "에서 만나요",
  decidedBy: " 정했어요",
  /** 그 역까지 갈 수 없는 사람(정한 역이 그 사람에게 후보 밖일 때). */
  noRoute: "경로 없음",
  /** 공유 링크 그림의 요약: "가장 오래 걸려도 31분 · 차이 11분". 0분인 사람(만날 역이 바로 출발역)은 "바로 여기". */
  longestPrefix: "가장 오래 걸려도 ",
  spreadPrefix: "차이 ",
  zeroMinutes: "바로 여기",
  modeFair: "공평하게 고름",
  modeFast: "가장 빠른 만남으로 고름",
  modeFavorSuffix: " 쪽으로 고름",
  ellipsis: "…",
  middleDot: "·",
  /** "{토요일 저녁} 기준". 구분 라벨은 서버가 주지만 글자는 여기서 서브셋에 넣는다(contracts/time-slots.json의 label). */
  basisSuffix: " 기준",
  whenWords: "평일 토요일 일요일·공휴일 아침 낮 저녁 밤",
} as const;

/**
 * 한 줄로 다 못 쓰는 이름은 이만큼 자르고 말줄임표를 붙인다(코드 포인트 수). 공유 링크 그림의 노선 이름 줄(32px, 약 490px 폭)에
 * "{이름} 1시간 59분"이 들어가는 길이다. 가장 긴 역 이름("동대문역사문화공원", 9자)은 자르지 않는다.
 */
export const OG_NAME_MAX = 10;

/** 서브셋에 반드시 들어가는 글자: 고정 문구 전부. */
export function ogFixedChars(): string[] {
  return [...new Set(Object.values(OG_TEXT).join(""))];
}
