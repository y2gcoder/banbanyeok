/**
 * 미리보기(OG) 이미지의 고정 문구·크기·색. 글꼴 서브셋 스크립트(`scripts/build-og-font.ts`)가 이 파일을 읽어
 * 여기 적힌 글자를 서브셋에 반드시 넣는다. 이미지에 쓰는 고정 문구는 **여기에만** 적는다(그래야 빈 네모가 생기지 않는다).
 *
 * 이 파일은 Node가 직접 실행하는 스크립트도 불러오므로 `@/` 별칭과 다른 모듈을 import하지 않는다.
 *
 * `lib/copy`는 잎 패키지다: 결과·방·공유·SEO가 모두 이 문구와 "서브셋에 있는 글자만 쓴다"는 제약을 쓰므로, 이것들이 서로를 거치지 않고
 * 여기를 바로 본다. 이 패키지는 다른 lib를 import하지 않는다(`.dependency-cruiser.cjs`의 `copy-is-leaf`).
 */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
/**
 * 사이트 기본 그림(`app/opengraph-image/route.tsx`). 결과가 없는 링크(모으는 중의 방 등)가 쓴다.
 * 카카오는 그림을 주소별로 오래 캐시하고 지우는 길이 없다. 주소가 같으면 그림이 바뀌어도 옛 그림이 나가므로, 그림이 바뀔 때만 바뀌는
 * `v`를 붙인다. 이 그림을 가리키는 곳은 모두 `SITE_OG_IMAGE_PATH`를 쓴다.
 *
 * `SITE_OG_IMAGE_VERSION`은 그림 입력(사이트 그림 문구·색·크기·글꼴 파일·그리는 코드)의 해시 앞 8자리다. 입력이 바뀌면
 * `site-og-image-version.test.ts`가 실패하고 새 값을 알려 준다. 배포마다 바뀌는 값을 쓰지 않는 이유는 그림이 그대로인데 캐시를 버리게 되기 때문이다.
 */
export const SITE_OG_IMAGE_VERSION = "a5ba6de0";
export const SITE_OG_IMAGE_PATH = `/opengraph-image?v=${SITE_OG_IMAGE_VERSION}`;

/**
 * 역 조합 페이지 그림(`app/(seo)/meet/[pair]/opengraph-image/route.tsx`)의 **고정 부분**(문구·색·크기·글꼴·그리는 코드) 버전.
 * 사이트 기본 그림과 같은 이유·방식이다(`site-og-image-version.test.ts`가 입력이 바뀌었는데 값이 그대로면 실패시킨다).
 * 조합마다 다른 부분(역 이름·후보·시간)은 `pair-og-image.ts`가 페이지 데이터로 더해, 그림이 바뀔 때만 주소의 `v`가 바뀐다.
 */
export const PAIR_OG_IMAGE_VERSION = "dfb4e426";

/**
 * 공유 링크 그림(`app/s/og/route.tsx`, "A 숫자판")의 버전. 이 그림은 결과마다 다르지만 **디자인(문구·색·크기·글꼴·그리는 코드·문장 규칙)이 같으면**
 * 같은 결과는 같은 그림이다. 그래서 `/s/og` 주소에 `iv=`로 붙여(`sharedImagePath`) 디자인이 바뀔 때만 주소가 바뀌게 한다.
 * 입력이 바뀌면 `components/og/og-image-version.test.ts`가 실패하고 새 값을 알려 준다(바뀐 값을 여기에 적는다).
 * 방 미리보기(`/r/og`)는 다른 그림(`SharedCard`)이고 `ROOM_OG_IMAGE_VERSION`을 쓴다.
 */
export const SHARED_OG_IMAGE_VERSION = "22d0bb00";

/**
 * 방 미리보기 그림(`app/r/[roomId]/og/route.tsx`, 노선 그림 `SharedCard`)의 버전. 숫자판과 같은 이유·방식이다: 방의 공유 번호(`sv`)는
 * 방 내용이 바뀔 때만 오르므로, 그림을 그리는 코드·문구만 바뀐 뒤 같은 방을 다시 공유하면 주소가 같아 옛 그림이 캐시에서 나온다.
 * 그래서 `/r/<id>/og` 주소에 `iv=`로 붙인다(`roomImagePath`). 입력이 바뀌면 `components/og/og-image-version.test.ts`가 새 값을 알려 준다.
 */
export const ROOM_OG_IMAGE_VERSION = "0100f6b4";

/**
 * 방 공유의 **보이는 범위 정책** 버전. 방 내용(공유 번호 `sv`)과 그리는 코드(`ROOM_OG_IMAGE_VERSION`)가 그대로여도, 서버가 같은 방을
 * 남에게 다르게 보이게 바뀌면(무엇을 싣고 어떻게 가리는지) 메신저가 캐시한 옛 미리보기가 같은 주소로 계속 나간다. 그래서 공유 링크와
 * 그림 주소에 `pv=`로 붙이고(`roomShareLink`·`roomImagePath`) 방 그림 버전의 해시 입력에도 넣는다. 공개 범위가 바뀌는 서버 변경과 같은
 * 배포에서 올린다. 1 → 2: 출발역을 숨긴 사람의 시간을 남에게 5분 단위로, 환승은 숨김(#142).
 * 2 → 3: 방의 기본 기준이 숨긴 사람 쪽이면 남에게는 공평하게로, 배려 상한에서 숨긴 사람을 뺌(#162).
 */
export const ROOM_SHARE_POLICY_VERSION = 3;

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
  /** 만날 역 호선 배지 넘침 표기. 노선 글자는 build-og-font.ts가 역 인덱스에서 자동 수집한다. */
  moreLines: "외 ",
  brand: "반반역",
  taglineTop: "우리 어디서 만나면",
  taglineBottom: "딱 반반일까?",
  taglineSub: "각자 지하철 시간으로 계산해요",
  pairQuestion: "어디서 만나면 딱 반반일까?",
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
  /**
   * 배려 대상을 뽑기로 정한 방에서 뽑은 뒤(#172): 결과를 방에서 보게 당첨자와 1위 역을 숨긴 그림. 큰 줄 두 줄("사다리 결과가 / 나왔어요!"),
   * 고리 안의 "?", 아래 두 줄("누구 쪽일까요?" / "방에서 확인해요"). 이름 옆에 시간을 쓰지 않는다.
   */
  drawTeaserHead: "사다리 결과가",
  drawTeaserTail: "나왔어요!",
  drawTeaserQuestion: "누구 쪽일까요?",
  drawTeaserHint: "방에서 확인해요",
  drawTeaserMark: "?",
  /** 공유 링크 그림 "A 숫자판"(`/s/og`): 차이가 아주 작을 때의 칭호와 지도 한가운데 비교 문장 "지도 한가운데인 한강진역이면 잠실은 14분 더 걸려요". */
  evenTitle: "완벽한 반반",
  middleLead: "지도 한가운데인 ",
  middleIf: "이면 ",
  middleMore: " 더 걸려요",
  middleLongest: "가장 오래 걸리는 사람",
  /**
   * 반반지수(#202, `lib/result/banban-index.ts`). 기본 층 "가장 오래 걸리는 사람도 38분이에요". 강조 층 "걸리는 시간이 두 사람 1분 차이예요",
   * "걸리는 시간이 모두 4분 차이 안이에요", 0분이면 "걸리는 시간이 모두 같아요". 화면의 분 차이만 말하고 '도착'은 쓰지 않는다.
   */
  banbanLongestLead: "가장 오래 걸리는 사람도 ",
  banbanLongestTail: "이에요",
  banbanCloseLead: "걸리는 시간이 ",
  banbanPair: "두 사람 ",
  banbanGroup: "모두 ",
  banbanPairTail: " 차이예요",
  banbanGroupTail: " 차이 안이에요",
  banbanSame: "같아요",
  /**
   * 공유 그림의 막차 줄(#62): "막차 23:52"(직행 확정, 분 그대로), "늦어도 23:00"(여유 시각, 10분 단위로 내린 값).
   * 시계 숫자와 쌍점은 `clockChars`로 서브셋에 넣는다.
   */
  lastTrain: "막차 ",
  lastTrainBy: "늦어도 ",
  /** 자정을 넘긴 시각 앞에 붙인다: "막차 다음 날 00:03". 그림만 봐도 그날 새벽으로 읽히지 않게. */
  nextDay: "다음 날 ",
  clockChars: "0123456789:",
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
