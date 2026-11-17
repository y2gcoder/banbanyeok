/**
 * 방 공유 문구의 단일 원본. 서버 미리보기(`GET /rooms/{id}/preview`, 누가 묻든 같은 값이고 출발역 필드가 없다)에서 링크 미리보기
 * (og:title·description), 미리보기 그림 값, 공유 시트 문구와 버튼 이름을 한 번에 만든다. 메타데이터(`/r/[roomId]`), 그림
 * (`/r/[roomId]/og`), 방 화면의 공유 칸이 모두 이 결과만 쓴다. 이름은 서버 짧은 이름이고, 그림에 넣을 때만 `ogSafeName`으로 거른다.
 */
import type { Mode, RoomPreview, TimeBasis } from "@/lib/api/types";
import { withJosa } from "@/lib/display/korean";
import { formatSeconds, minutesFromSeconds } from "@/lib/display/minutes";
import { modeSentence } from "@/lib/result/mode-sentence";
import { ogSafeName } from "@/lib/seo/og-coverage";
import { OG_TEXT } from "@/lib/seo/og-text";
import type { SharedCardData } from "@/lib/seo/shared-preview";
import { DEFAULT_SLOT } from "@/lib/when/time-slot";
import { meetingWhenText } from "./dates";

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

/** 모으는 중의 초대. 미리보기를 못 받았을 때(서버 실패·옛 서버·번호가 지금보다 큼)도 이 문구를 쓴다. */
export const INVITE_COPY: RoomShareCopy = {
  stage: "collecting",
  preview: {
    title: "같이 만날 역 정해요",
    description: "각자 출발역을 넣으면 모두에게 공평한 만날 역을 지하철 시간으로 계산해요. 출발역은 숨길 수도 있어요.",
  },
  message: {
    title: "같이 만날 역 정해요",
    text: "각자 출발역을 넣으면 모두에게 공평한 만날 역을 계산해 줘요. 출발역은 숨길 수도 있어요.",
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

function card(preview: Computed, suffix: string, modeLine: string, footer?: SharedCardData["footer"]): SharedCardData {
  const favored = preview.stage === "result" && preview.basis.mode === "favor" ? preview.basis.favorLabel : null;
  return {
    stationName: preview.station.stationName,
    suffix,
    people: preview.station.times.map((t, index) => ({
      name: ogSafeName(t.label, `참가자 ${index + 1}`),
      minutes: t.seconds === null ? null : minutesFromSeconds(t.seconds),
      favored: favored !== null && t.label === favored,
    })),
    modeLine,
    ...(footer ? { footer } : {}),
  };
}

function resultCopy(preview: Extract<RoomPreview, { stage: "result" }>): RoomShareCopy {
  const { stationName } = preview.station;
  const times = timesText(preview);
  const basisLine = modeSentence(preview.basis.mode, preview.basis.favorLabel) + basisSuffix(preview.room.timeBasis);
  const [title, description] = preview.room.canJoin
    ? [
        leadingTitle(stationName, preview.basis.mode, preview.basis.favorLabel),
        `아직이면 출발역 넣어 주세요${SEP}${times}`,
      ]
    : [`${stationName}${OG_TEXT.sharedSuffix}`, `${times}${SEP}${basisLine}`];
  const favorSafe = preview.basis.favorLabel === null ? null : ogSafeName(preview.basis.favorLabel, "");
  return {
    stage: "result",
    preview: { title, description },
    message: { title, text: description, button: "카톡으로 결과 보내기" },
    card: card(
      preview,
      OG_TEXT.sharedSuffix,
      modeSentence(preview.basis.mode, favorSafe || null) + basisSuffix(preview.room.timeBasis),
    ),
  };
}

function decidedCopy(preview: Extract<RoomPreview, { stage: "decided" }>): RoomShareCopy {
  const { room } = preview;
  const when = meetingWhenText(room.meetingDate, room.meetingTime, room.meetingBand);
  const decided = (name: string) => `${withJosa(name, "이/가")}${OG_TEXT.decidedBy}`;
  const title = `${preview.station.stationName}${OG_TEXT.decidedSuffix}`;
  const description = [decided(preview.decidedBy), when, timesText(preview)].filter(Boolean).join(SEP);
  const by = decided(ogSafeName(preview.decidedBy, "참가자"));
  const longest = Math.max(...preview.station.times.flatMap((t) => (t.seconds === null ? [] : [t.seconds])));
  const sub = when ?? (Number.isFinite(longest) ? `${OG_TEXT.longestPrefix}${formatSeconds(longest)}` : "");
  return {
    stage: "decided",
    preview: { title, description },
    message: { title, text: description, button: "카톡으로 정한 역 알리기" },
    card: card(preview, OG_TEXT.decidedSuffix, by, { main: by, sub }),
  };
}

export function roomShareCopy(preview: RoomPreview): RoomShareCopy {
  switch (preview.stage) {
    case "collecting":
      return INVITE_COPY;
    case "result":
      return resultCopy(preview);
    case "decided":
      return decidedCopy(preview);
  }
}
