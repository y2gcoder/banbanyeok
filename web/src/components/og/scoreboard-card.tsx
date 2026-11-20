import { formatMinutes } from "@/lib/display/minutes";
import { OG_COLORS, OG_TEXT } from "@/lib/seo/og-text";
import type { ScoreboardCardData } from "@/lib/seo/scoreboard-card-data";
import { Dot, OgFrame, personHex } from "./frame";

/**
 * 공유 링크(`/s?...`)의 미리보기 그림 "A 숫자판"(#68): 각자의 시간이 주인공이다.
 * 위에서 아래로: 제목 "{1위역}에서 볼까?" → 사람 칸마다 (색 점 + 이름) 아래에 큰 시간과 작은 막차 줄 → "차이 N분" 칩(+ 차이가 아주 작으면 노란 "완벽한 반반") →
 * 맨 아래 한 줄(지도 한가운데 비교, 없으면 기준 한 마디). 카카오 말풍선(약 270px 폭)에서도 숫자가 먼저 읽히게 크게 그린다.
 * 이름 길이와 상관없이 시간은 같은 높이에 둔다(이름 줄이 한 줄 높이로 고정이고 긴 이름은 말줄임표).
 * 방 미리보기(`/r/og`)는 아직 노선 그림(`SharedCard`)이다. 그리는 코드나 문구가 바뀌면 `SHARED_OG_IMAGE_VERSION`을 올려야 한다.
 */

/** 사람 수별 숫자 최대 크기와 칸 폭. 4명이어도 칸 폭이 같아 숫자가 한 줄로 늘어선다(칸 폭 × 사람 수 ≤ 안쪽 폭 1072). */
const NUMBER_SIZE: Record<number, number> = { 2: 132, 3: 112, 4: 92 };
const COLUMN: Record<number, number> = { 2: 400, 3: 340, 4: 268 };
const COLUMN_PADDING = 22;

function minutesText(minutes: number | null): string {
  if (minutes === null) return OG_TEXT.noRoute;
  return minutes === 0 ? OG_TEXT.zeroMinutes : formatMinutes(minutes);
}

/** 굵은 숫자·한글의 대략의 폭(em). "1시간 4분"처럼 길면 칸 폭에 맞춰 줄인다. */
function emWidth(text: string): number {
  return Array.from(text).reduce((sum, ch) => sum + (/[0-9]/.test(ch) ? 0.62 : ch === " " ? 0.3 : 0.95), 0);
}

/**
 * 시간 아래의 막차 줄(#62): "막차 23:52" / "늦어도 23:00" / "막차 다음 날 00:03". 한 사람이라도 있을 때만 줄 자리를 잡는다(없는 그림은 예전과 같다).
 * 줄이 생기면 그만큼 큰 숫자를 줄이고 위아래 틈을 좁혀, 맨 아래 문장이 두 줄이어도 넘치지 않게 한다.
 */
const LAST_TRAIN_ROW = 40;
/** 가장 긴 줄 "늦어도 다음 날 00:00"이 칸 폭(4명 246px)에 한 줄로 들어가는 크기. */
const LAST_TRAIN_SIZE: Record<number, number> = { 2: 30, 3: 26, 4: 23 };
const WITH_LAST_TRAIN = { numberScale: 0.88, headGap: 18, chipGap: 12 } as const;
const WITHOUT_LAST_TRAIN = { numberScale: 1, headGap: 26, chipGap: 22 } as const;

/** 모든 사람이 같은 크기를 쓴다(한 사람만 작아지면 숫자판이 고르지 않다). 가장 긴 시간 글자가 칸에 들어가는 크기. */
function numberSize(texts: string[], count: number, scale: number): number {
  const column = COLUMN[count] ?? 268;
  const widest = Math.max(...texts.map(emWidth));
  return Math.min(Math.floor((NUMBER_SIZE[count] ?? 92) * scale), Math.floor((column - COLUMN_PADDING - 8) / widest));
}

/** 제목은 한 줄에 들어가게 글자 수로 줄인다(안쪽 폭 1072, Bold 한글은 글자당 대략 0.95em). */
function headSize(text: string): number {
  return Math.min(92, Math.floor(1060 / (Array.from(text).length * 0.98)));
}

function Chip({ children, background, color }: { children: string; background: string; color: string }) {
  return (
    <div
      style={{
        display: "flex",
        backgroundColor: background,
        color,
        fontSize: 40,
        padding: "8px 24px",
        borderRadius: 14,
      }}
    >
      {children}
    </div>
  );
}

export function ScoreboardCard({ data }: { data: ScoreboardCardData }) {
  const head = `${data.stationName}${data.suffix ?? OG_TEXT.sharedSuffix}`;
  const count = data.people.length;
  const column = COLUMN[count] ?? 268;
  const texts = data.people.map((p) => minutesText(p.minutes));
  const hasLastTrain = data.people.some((p) => p.lastTrain);
  const layout = hasLastTrain ? WITH_LAST_TRAIN : WITHOUT_LAST_TRAIN;
  const size = numberSize(texts, count, layout.numberScale);
  const bottom = data.compareLine ?? data.modeLine;
  return (
    <OgFrame>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingTop: 10 }}>
        <span style={{ fontSize: headSize(head), letterSpacing: -4, lineHeight: 1.05 }}>{head}</span>
        <div style={{ display: "flex", marginTop: layout.headGap }}>
          {data.people.map((person, i) => (
            <div
              key={`person-${String(i)}`}
              style={{
                display: "flex",
                flexDirection: "column",
                width: column,
                paddingLeft: i === 0 ? 0 : COLUMN_PADDING,
                borderLeft: i === 0 ? "none" : `3px solid ${OG_COLORS.rule}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, height: 36 }}>
                <Dot color={personHex(i)} size={22} />
                <span
                  style={{
                    fontSize: count <= 2 ? 30 : 26,
                    color: OG_COLORS.muted,
                    maxWidth: column - COLUMN_PADDING - 40,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {person.name}
                </span>
              </div>
              <span style={{ fontSize: size, letterSpacing: -4, lineHeight: 1.1 }}>{texts[i]}</span>
              {hasLastTrain ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    height: LAST_TRAIN_ROW,
                    fontSize: LAST_TRAIN_SIZE[count] ?? 23,
                    color: OG_COLORS.inkSoft,
                  }}
                >
                  {person.lastTrain ?? ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: layout.chipGap }}>
          {data.spread !== null ? (
            <Chip
              background={OG_COLORS.ink}
              color={OG_COLORS.surface}
            >{`${OG_TEXT.spreadPrefix}${formatMinutes(data.spread)}`}</Chip>
          ) : null}
          {data.title ? (
            <Chip background={OG_COLORS.safety} color={OG_COLORS.ink}>
              {data.title}
            </Chip>
          ) : null}
          {data.compareLine && data.basisLine ? (
            <span style={{ fontSize: 28, color: OG_COLORS.muted, marginLeft: 6 }}>{data.basisLine}</span>
          ) : null}
        </div>
        <div style={{ display: "flex", marginTop: "auto" }}>
          {/* 한국어도 낱말 단위로 줄을 바꾼다("저녁"이 "저/녁"으로 갈리지 않게). */}
          <span
            style={{
              fontSize: 30,
              lineHeight: 1.25,
              color: data.compareLine ? OG_COLORS.inkSoft : OG_COLORS.muted,
              wordBreak: "keep-all",
            }}
          >
            {bottom}
          </span>
        </div>
      </div>
    </OgFrame>
  );
}
