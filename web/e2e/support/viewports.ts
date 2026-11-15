import { devices } from "@playwright/test";

/**
 * 반응형 점검 뷰포트 행렬(docs/setup/u1-notes.md 2절). 크기는 CSS px(레이아웃 뷰포트)이고, 가능한 한 Playwright 기기 설명자
 * (`@playwright/test`의 `devices`, 1.65.0)에서 그대로 가져온다. 설명자에 없는 기기는 제조사 공식 해상도 ÷ 기기 픽셀 비율로
 * 계산한 값이며 노트에 근거를 적었다.
 */
export type ViewportCase = {
  /** 캡처 폴더·테스트 이름. */
  id: string;
  /** 사람이 읽는 설명. */
  label: string;
  width: number;
  height: number;
  /** 터치 기기(모바일 UA·터치·isMobile). 데스크톱은 false. */
  touch: boolean;
  /** 이 행렬에서 기기 분류. 캡처는 분류마다 최소 하나씩 남긴다. */
  kind: "phone" | "fold-cover" | "fold-open" | "landscape" | "tablet" | "desktop" | "zoom";
  /** 기기 픽셀 비율. 브라우저 확대는 "CSS 폭 = 창 폭 ÷ 배율, 픽셀 비율 = 배율"과 같다. 기본: 터치 2, 데스크톱 1. */
  scale?: number;
};

const vp = (name: keyof typeof devices) => {
  const d = devices[name];
  if (!d) throw new Error(`no device descriptor: ${String(name)}`);
  return d.viewport;
};

export const VIEWPORTS: readonly ViewportCase[] = [
  // 폰(세로)
  { id: "phone-320", label: "iPhone SE (최소 보장)", ...vp("iPhone SE"), touch: true, kind: "phone" },
  { id: "phone-360", label: "Galaxy S24", ...vp("Galaxy S24"), touch: true, kind: "phone" },
  { id: "phone-390", label: "iPhone 14", ...vp("iPhone 14"), touch: true, kind: "phone" },
  { id: "phone-393", label: "iPhone 16", ...vp("iPhone 16"), touch: true, kind: "phone" },
  { id: "phone-412", label: "Pixel 7", ...vp("Pixel 7"), touch: true, kind: "phone" },
  { id: "phone-430", label: "iPhone 15 Pro Max", ...vp("iPhone 15 Pro Max"), touch: true, kind: "phone" },
  // 폴더블 접힘(커버 화면): 세로로 아주 길다
  // Z Fold5 커버 904×2316(삼성 공식) ÷ 기기 픽셀 비율 2.625 ≈ 344×882(화면 전체. 주소창이 빠지면 더 짧다)
  { id: "fold-cover-344", label: "Galaxy Z Fold5 커버", width: 344, height: 882, touch: true, kind: "fold-cover" },
  {
    id: "fold-cover-360",
    label: "Galaxy Z Fold7 커버",
    ...vp("Galaxy Z Fold 7 Cover"),
    touch: true,
    kind: "fold-cover",
  },
  // Z Fold7 커버 1080×2520(삼성 공식) ÷ 2.625(화면 크기를 작게 둔 설정) ≈ 411×960
  {
    id: "fold-cover-411",
    label: "Galaxy Z Fold7 커버(작은 배율)",
    width: 411,
    height: 960,
    touch: true,
    kind: "fold-cover",
  },
  // 폴더블 펼침: 거의 정사각형, 세로·가로
  // 펼친 폭은 기기 픽셀 비율(화면 크기 설정)에 따라 690~990으로 달라진다.
  // Z Fold5 메인 1812×2176(삼성 공식) ÷ 2.625(커버와 같은 비율) ≈ 690×829 — 이 행렬에서 가장 좁은 펼침 화면
  { id: "fold-open-690", label: "Galaxy Z Fold5 펼침", width: 690, height: 829, touch: true, kind: "fold-open" },
  {
    id: "fold-open-829-land",
    label: "Galaxy Z Fold5 펼침 가로",
    width: 829,
    height: 690,
    touch: true,
    kind: "fold-open",
  },
  { id: "fold-open-928", label: "Galaxy Z Fold6 펼침", ...vp("Galaxy Z Fold 6"), touch: true, kind: "fold-open" },
  { id: "fold-open-984", label: "Galaxy Z Fold7 펼침", ...vp("Galaxy Z Fold 7"), touch: true, kind: "fold-open" },
  {
    id: "fold-open-1028-land",
    label: "Galaxy Z Fold6 펼침 가로",
    ...vp("Galaxy Z Fold 6 landscape"),
    touch: true,
    kind: "fold-open",
  },
  // 가로로 눕힌 폰: 높이가 짧다
  { id: "land-568", label: "iPhone SE 가로", ...vp("iPhone SE landscape"), touch: true, kind: "landscape" },
  {
    id: "land-667",
    label: "iPhone 8 가로(두 칸이 되는 가장 좁은 폰)",
    ...vp("iPhone 8 landscape"),
    touch: true,
    kind: "landscape",
  },
  { id: "land-756", label: "iPhone 17 Pro 가로", ...vp("iPhone 17 Pro landscape"), touch: true, kind: "landscape" },
  { id: "land-863", label: "Pixel 7 가로", ...vp("Pixel 7 landscape"), touch: true, kind: "landscape" },
  // 태블릿
  { id: "tablet-640", label: "Galaxy Tab S9(두 칸 경계)", ...vp("Galaxy Tab S9"), touch: true, kind: "tablet" },
  { id: "tablet-768", label: "iPad Mini", ...vp("iPad Mini"), touch: true, kind: "tablet" },
  // iPad Air 1640×2360(애플 공식) ÷ 2 = 820×1180
  { id: "tablet-820", label: "iPad Air", width: 820, height: 1180, touch: true, kind: "tablet" },
  { id: "tablet-1024-land", label: "iPad Mini 가로", ...vp("iPad Mini landscape"), touch: true, kind: "tablet" },
  // 데스크톱(맥 Safari·Chrome 창 크기)
  { id: "desktop-1280", label: "데스크톱 1280×800", width: 1280, height: 800, touch: false, kind: "desktop" },
  { id: "desktop-1440", label: "데스크톱 1440×900", width: 1440, height: 900, touch: false, kind: "desktop" },
  { id: "desktop-1920", label: "데스크톱 1920×1080", width: 1920, height: 1080, touch: false, kind: "desktop" },
  // 브라우저 확대 200%(WCAG 1.4.4·1.4.10): 1280×800 창 → CSS 640×400, 1440×900 창 → CSS 720×450
  { id: "zoom200-1280", label: "1280×800 창 확대 200%", width: 640, height: 400, touch: false, kind: "zoom", scale: 2 },
  { id: "zoom200-1440", label: "1440×900 창 확대 200%", width: 720, height: 450, touch: false, kind: "zoom", scale: 2 },
  // 확대 400%(WCAG 1.4.10 reflow 기준 320 CSS px): 1280 창 → 320×200
  { id: "zoom400-1280", label: "1280×800 창 확대 400%", width: 320, height: 200, touch: false, kind: "zoom", scale: 4 },
];

/** 전후 캡처를 남길 대표 기기: 폰·폴드 접힘·폴드 펼침(세로·가로)·데스크톱, 그리고 경첩 흉내(fold-split-928). */
export const SHOT_IDS = new Set([
  "phone-390",
  "fold-cover-344",
  "fold-open-690",
  "fold-open-1028-land",
  "desktop-1280",
  "fold-split-928",
]);

/** 캡처할 화면(저장소 크기를 위해 배치가 바뀌는 화면만). */
export const SHOT_SCREENS = new Set(["home", "result", "room-new", "room-friend-join", "room-host-full", "meet-pair"]);
