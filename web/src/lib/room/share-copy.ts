/**
 * 방 공유 문구의 단일 원본. 서버 미리보기(`GET /rooms/{id}/preview`, 누가 묻든 같은 값이고 출발역 필드가 없다)에서 링크 미리보기
 * (og:title·description), 미리보기 그림 값, 공유 시트 문구와 버튼 이름을 한 번에 만든다. 메타데이터(`/r/[roomId]`), 그림
 * (`/r/[roomId]/og`), 방 화면의 공유 칸, 카카오톡 공유 메시지(`roomKakaoMessage`)가 모두 이 결과만 쓴다. 이름은 서버 짧은 이름이고, 그림에
 * 넣을 때만 `ogSafeName`으로 거른다.
 */
import type { Mode, RoomPreview, TimeBasis } from "@/lib/api/types";
import { ogSafeName } from "@/lib/copy/og-coverage";
import { OG_TEXT, SITE_OG_IMAGE_PATH } from "@/lib/copy/og-text";
import { withJosa } from "@/lib/display/korean";
import { formatSeconds, minutesFromSeconds } from "@/lib/display/minutes";
import { banbanLine, mayIncludeHidden } from "@/lib/result/banban-index";
import { lastTrainCardLine, lastTrainState } from "@/lib/result/last-train";
import { middleSentence, middleView } from "@/lib/result/map-middle";
import { modeSentence } from "@/lib/result/mode-sentence";
import type { KakaoFeedMessage } from "@/lib/share/kakao";
import type { SharedCardData } from "@/lib/share-card/shared-preview";
import { meetingWhenText } from "@/lib/when/dates";
import { DEFAULT_SLOT } from "@/lib/when/time-slot";
import { roomImagePath, roomShareLink } from "./share-link";

export type ShareStage = RoomPreview["stage"];

export type RoomShareCopy = {
  stage: ShareStage;
  /** 링크 미리보기(og:title·og:description). */
  preview: { title: string; description: string };
  /** 공유 시트·복사 대화상자의 제목·본문과 공유 버튼 이름. */
  message: { title: string; text: string; button: string };
  /** 미리보기 그림 값. null이면 사이트 기본 그림(모으는 중). */
  card: SharedCardData | null;
};

type Computed = Exclude<RoomPreview, { stage: "collecting" }>;

/**
 * 방 미리보기 그림(`/r/<id>/og`)에 귀갓길 막차 줄(#62)을 그릴지. 처리방침 6항의 방 링크 미리보기 목록에 "출발역을 공개한 참여자의
 * 귀갓길 막차 시각(출발역을 숨긴 사람은 넣지 않음)"을 적은 판(#84)부터 켠다. `policy.test.ts`가 6항에 "막차"가 없는데 켜져 있으면
 * 실패한다. 켜고 끄면 그림이 달라지므로 `ROOM_OG_IMAGE_VERSION`도 바뀐다(스위치 상태로 센다). 출발역을 숨긴 사람에게는 서버가
 * 막차를 주지 않는다(미리보기는 누가 묻든 같은 값이다). 결과·방 화면의 막차 칸과 공유 링크 숫자판(`/s/og`)은 이 스위치와 상관없다.
 */
export const ROOM_PREVIEW_LAST_TRAIN: boolean = true;

/** `lastTrain`은 그림 값에 막차 줄을 넣을지. 기본은 `ROOM_PREVIEW_LAST_TRAIN`이고, 테스트가 켠 모습과 끈 모습을 둘 다 보려고 받는다. */
type ShareCopyOptions = { lastTrain?: boolean };

/** 모으는 중의 초대. 미리보기를 못 받았을 때(서버 실패·옛 서버·번호가 지금보다 큼)도 이 문구를 쓴다. */
export const INVITE_COPY: RoomShareCopy = {
  stage: "collecting",
  preview: {
    title: "같이 만날 역 정해요",
    description: "각자 출발역을 넣으면 모두에게 공평한 만날 역을 지하철 시간으로 계산해요.",
  },
  message: {
    title: "같이 만날 역 정해요",
    text: "각자 출발역을 넣으면 모두에게 공평한 만날 역을 계산해 줘요.",
    button: "카톡으로 보내기",
  },
  card: null,
};

const SEP = ` ${OG_TEXT.middleDot} `;

/** "민수 22분 · 참가자 2 19분". 갈 수 없는 사람은 글에서 뺀다(그림에는 "경로 없음"으로 남는다). */
function timesText(preview: Computed): string {
  return preview.station.times
    .flatMap((t) => (t.seconds === null ? [] : [`${t.label} ${formatSeconds(t.seconds)}`]))
    .join(SEP);
}

/** 평일 낮이 아니면 " · 토요일 저녁 기준"(혼자 입력한 링크와 같은 규칙). */
function basisSuffix(basis: TimeBasis): string {
  return basis.timeSlot === DEFAULT_SLOT ? "" : `${SEP}${basis.label}${OG_TEXT.basisSuffix}`;
}

/** 아직 들어올 수 있는 방의 제목: 지금 1위가 왜 1위인지 방의 기본 기준으로 말한다. */
function leadingTitle(station: string, mode: Mode, favorLabel: string | null): string {
  const subject = withJosa(station, "이/가");
  if (mode === "fair") return `지금은 ${subject} 제일 공평해요`;
  if (mode === "fast") return `지금은 ${subject} 제일 빨라요`;
  return favorLabel ? `지금은 ${favorLabel} 쪽으로 ${subject} 좋아요` : `지금은 ${subject} 제일 나아요`;
}

/** 그림에 그릴 이름. 글꼴에 남는 글자가 없으면 순번("참가자 N", `sharedCardData`와 같은 규칙). */
const safeName = (label: string, index: number) => ogSafeName(label, `참가자 ${index + 1}`);

/** 배려 대상·정한 사람은 서버가 짧은 이름만 주므로, 그 이름의 줄과 같은 순번으로 그린다. */
function cardName(preview: Computed, label: string): string {
  return safeName(
    label,
    preview.station.times.findIndex((t) => t.label === label),
  );
}

/**
 * 1위 단계의 "지도 한가운데였다면" 비교(#68 2단계). 서버는 방의 기본 기준이 공평이고 출발역을 숨긴 사람이 없을 때만 `mapMiddle`을 준다.
 * 웹은 공평 기준인지와 화면 숫자(반올림한 분) 기준의 5분 규칙을 한 번 더 거른다(무상태 링크의 `toMapMiddleView`와 같은 규칙).
 * `name`은 이름을 고르는 방법(글은 서버 짧은 이름, 그림은 글꼴에 있는 글자로 거른 이름).
 */
function middleLine(preview: Computed, name: (index: number) => string): string | null {
  if (preview.stage !== "result" || preview.basis.mode !== "fair" || !preview.mapMiddle) return null;
  const minutes = preview.station.times.map((t) => (t.seconds === null ? null : minutesFromSeconds(t.seconds)));
  if (minutes.some((m) => m === null)) return null;
  const view = middleView(preview.mapMiddle, {
    stationCode: preview.station.stationCode,
    minutes: minutes as number[],
  });
  return view ? middleSentence(view, name(view.personIndex)) : null;
}

/**
 * 1위 단계의 반반지수(#202). 미리보기에는 숨김 표시가 없으므로, 숨긴 사람의 시간처럼 300초의 배수인 시간이 있으면 끈다.
 * 숨긴 사람의 시간은 남에게 5분 단위로 올라가 본인 화면과 말이 갈리기 때문이다.
 */
function banbanOf(preview: Computed) {
  if (preview.stage !== "result") return null;
  const seconds = preview.station.times.map((t) => t.seconds);
  return banbanLine({
    mode: preview.basis.mode,
    minutes: seconds.map((s) => (s === null ? null : minutesFromSeconds(s))),
    hidden: mayIncludeHidden(seconds),
  });
}

function card(
  preview: Computed,
  suffix: string,
  modeLine: string,
  showLastTrain: boolean,
  footer?: SharedCardData["footer"],
): SharedCardData {
  const comparison = middleLine(preview, (index) => safeName(preview.station.times[index]?.label ?? "", index));
  const favored = preview.stage === "result" && preview.basis.mode === "favor" ? preview.basis.favorLabel : null;
  const meeting = { date: preview.room.meetingDate, time: preview.room.meetingTime };
  const banban = banbanOf(preview);
  return {
    stationCode: preview.station.stationCode,
    stationName: preview.station.stationName,
    suffix,
    people: preview.station.times.map((t, index) => {
      // 출발역을 숨긴 사람은 서버가 막차를 주지 않는다(미리보기는 누가 묻든 같은 값이다). 약속보다 먼저 떠나는 열차는 줄을 비운다.
      const lastTrain = showLastTrain ? lastTrainCardLine(lastTrainState(t.lastTrain, meeting), OG_TEXT) : null;
      return {
        name: safeName(t.label, index),
        minutes: t.seconds === null ? null : minutesFromSeconds(t.seconds),
        favored: favored !== null && t.label === favored,
        ...(lastTrain ? { lastTrain } : {}),
      };
    }),
    modeLine,
    ...(footer ? { footer } : {}),
    ...(comparison ? { middleLine: comparison } : {}),
    ...(banban ? { banban } : {}),
  };
}

/**
 * 뽑기 방에서 뽑은 뒤의 결과 단계(#172): 메신저에 보이는 미리보기(og 제목·설명·그림)와 공유 문구에 당첨자와 1위 역(과 그 역까지의
 * 시간)을 넣지 않는다. 받는 사람이 방에서 사다리를 처음 보게 하려는 것이라 결과를 감추지는 않는다: 미리보기 응답(API)과 방 화면에는
 * 그대로 있다. 참여자 이름만 기존 규칙대로 싣는다. 정한 역 단계는 정한 역을 그대로 보인다(`decidedCopy`).
 */
function drawTeaserCopy(preview: Extract<RoomPreview, { stage: "result" }>): RoomShareCopy {
  const title = `${OG_TEXT.drawTeaserHead} ${OG_TEXT.drawTeaserTail} ${OG_TEXT.drawTeaserQuestion}`;
  const names = preview.station.times.map((t) => t.label).join(SEP);
  const hint = `사다리 결과는 ${OG_TEXT.drawTeaserHint}`;
  const description = preview.room.canJoin
    ? `아직이면 출발역 넣어 주세요${SEP}${names}${SEP}${hint}`
    : `${names}${SEP}${hint}`;
  return {
    stage: "result",
    preview: { title, description },
    message: { title, text: description, button: "카톡으로 결과 보내기" },
    card: {
      stationName: OG_TEXT.drawTeaserHead,
      suffix: OG_TEXT.drawTeaserTail,
      people: preview.station.times.map((t, index) => ({
        name: safeName(t.label, index),
        minutes: null,
        favored: false,
      })),
      modeLine: OG_TEXT.drawTeaserHint,
      footer: { main: OG_TEXT.drawTeaserQuestion, sub: OG_TEXT.drawTeaserHint },
      teaser: true,
    },
  };
}

function resultCopy(preview: Extract<RoomPreview, { stage: "result" }>, showLastTrain: boolean): RoomShareCopy {
  if (preview.basis.mode === "favor" && preview.basis.drawRound !== undefined) return drawTeaserCopy(preview);
  const { stationName } = preview.station;
  const times = timesText(preview);
  const basisLine = modeSentence(preview.basis.mode, preview.basis.favorLabel) + basisSuffix(preview.room.timeBasis);
  // 지도 한가운데 비교는 무상태 링크(`sharedPreview`)처럼 설명 끝에 붙인다(잘려도 앞의 시간은 남는다).
  const middle = middleLine(preview, (index) => preview.station.times[index]?.label ?? "");
  const tail = middle ? `${SEP}${middle}` : "";
  const [title, description] = preview.room.canJoin
    ? [
        leadingTitle(stationName, preview.basis.mode, preview.basis.favorLabel),
        `아직이면 출발역 넣어 주세요${SEP}${times}${tail}`,
      ]
    : [`${stationName}${OG_TEXT.sharedSuffix}`, `${times}${SEP}${basisLine}${tail}`];
  const favorName = preview.basis.favorLabel === null ? null : cardName(preview, preview.basis.favorLabel);
  return {
    stage: "result",
    preview: { title, description },
    message: { title, text: description, button: "카톡으로 결과 보내기" },
    card: card(
      preview,
      OG_TEXT.sharedSuffix,
      modeSentence(preview.basis.mode, favorName) + basisSuffix(preview.room.timeBasis),
      showLastTrain,
    ),
  };
}

function decidedCopy(preview: Extract<RoomPreview, { stage: "decided" }>, showLastTrain: boolean): RoomShareCopy {
  const { room } = preview;
  const when = meetingWhenText(room.meetingDate, room.meetingTime, room.meetingBand);
  const decided = (name: string) => `${withJosa(name, "이/가")}${OG_TEXT.decidedBy}`;
  const title = `${preview.station.stationName}${OG_TEXT.decidedSuffix}`;
  const description = [decided(preview.decidedBy), when, timesText(preview)].filter(Boolean).join(SEP);
  const by = decided(cardName(preview, preview.decidedBy));
  const longest = Math.max(...preview.station.times.flatMap((t) => (t.seconds === null ? [] : [t.seconds])));
  const sub = when ?? (Number.isFinite(longest) ? `${OG_TEXT.longestPrefix}${formatSeconds(longest)}` : "");
  return {
    stage: "decided",
    preview: { title, description },
    message: { title, text: description, button: "카톡으로 정한 역 알리기" },
    card: card(preview, OG_TEXT.decidedSuffix, by, showLastTrain, { main: by, sub }),
  };
}

export function roomShareCopy(preview: RoomPreview, options: ShareCopyOptions = {}): RoomShareCopy {
  const showLastTrain = options.lastTrain ?? ROOM_PREVIEW_LAST_TRAIN;
  switch (preview.stage) {
    case "collecting":
      return INVITE_COPY;
    case "result":
      return resultCopy(preview, showLastTrain);
    case "decided":
      return decidedCopy(preview, showLastTrain);
  }
}

/** 카카오톡 메시지의 버튼: 받는 사람이 그 방에서 할 일. 들어올 수 있으면 출발역 넣기, 꽉 찼으면 결과, 정했으면 방. */
function kakaoButton(preview: RoomPreview | undefined): string {
  if (!preview || preview.stage === "collecting") return "내 출발역 넣기";
  if (preview.stage === "decided") return "방 보기";
  return preview.room.canJoin ? "내 출발역 넣기" : "결과 보기";
}

/**
 * 카카오톡 공유 API로 보내는 메시지. 공유 시트와 같은 문구·같은 번호의 링크이고, 그림은 그 링크 미리보기의 그림(결과가 없으면 사이트
 * 기본 그림)이다. `preview`는 공유 칸이 쓰는 것과 같은 값(화면의 방과 번호가 같은 미리보기, 없으면 undefined)이다.
 */
export function roomKakaoMessage(roomId: string, preview: RoomPreview | undefined): KakaoFeedMessage {
  const copy = preview ? roomShareCopy(preview) : INVITE_COPY;
  const path = roomShareLink(roomId, preview?.room.shareVersion);
  const imagePath =
    preview && preview.stage !== "collecting"
      ? roomImagePath(roomId, preview.room.shareVersion, preview.dataVersion)
      : SITE_OG_IMAGE_PATH;
  return {
    title: copy.message.title,
    description: copy.message.text,
    imagePath,
    path,
    buttons: [{ title: kakaoButton(preview), path }],
  };
}
