import { formatMinutes } from "@/lib/display/minutes";
import { OG_COLORS, OG_TEXT } from "@/lib/seo/og-text";
import type { SharedCardData } from "@/lib/seo/shared-preview";
import { OgFrame, personHex } from "./frame";

/** 오른쪽 그림 영역(노선이 만날 역의 환승 고리로 모인다). */
const AREA = { width: 520, height: 456 } as const;
const RING_X = AREA.width - 70;
const START_X = 40;
/** 사람 수별 노선 사이 간격. 4명이어도 이름 줄이 겹치지 않는 간격. */
const GAP: Record<number, number> = { 2: 210, 3: 150, 4: 112 };
const LINE_WIDTH = 14;

/** 역 이름 글자 수에 맞춘 제목 크기(왼쪽 칸 폭 안에 한 줄). Bold 한글은 대략 글자당 0.95em. */
function headlineSize(stationName: string): number {
  const length = Array.from(stationName).length;
  return Math.min(168, Math.floor(540 / (length * 0.95)));
}

/**
 * 왼쪽 아래 요약: 큰 줄 "가장 오래 걸려도 31분", 작은 줄 "차이 11분". 길어져도 줄이 넘치지 않게 둘로 나눈다.
 * 갈 수 없는 사람은 빼고 센다. 아무도 시간이 없으면 요약 없이 기준 줄만 둔다.
 */
function summary(people: SharedCardData["people"]): { longest: string; spread: string } | null {
  const minutes = people.flatMap((p) => (p.minutes === null ? [] : [p.minutes]));
  if (minutes.length === 0) return null;
  const max = Math.max(...minutes);
  return {
    longest: `${OG_TEXT.longestPrefix}${formatMinutes(max)}`,
    spread: `${OG_TEXT.spreadPrefix}${formatMinutes(max - Math.min(...minutes))}`,
  };
}

function minutesText(minutes: number | null): string {
  if (minutes === null) return OG_TEXT.noRoute;
  return minutes === 0 ? OG_TEXT.zeroMinutes : formatMinutes(minutes);
}

function ys(count: number): number[] {
  const gap = GAP[count] ?? GAP[4] ?? 112;
  const middle = AREA.height / 2;
  return Array.from({ length: count }, (_, i) => middle + (i - (count - 1) / 2) * gap);
}

/** 고른 사람의 노선을 맨 위에 그린다(흐린 노선에 덮이지 않게). */
function drawOrder(people: SharedCardData["people"]): number[] {
  const order = people.map((_, i) => i);
  return [...order.filter((i) => !people[i]?.favored), ...order.filter((i) => people[i]?.favored)];
}

/** 각자의 노선(같은 길이)이 만날 역으로 모이는 그림. "누구 쪽으로"면 고른 사람의 노선만 진하게 둔다. */
function Lines({ people }: { people: SharedCardData["people"] }) {
  const rows = ys(people.length);
  const anyFavored = people.some((p) => p.favored);
  const ringY = AREA.height / 2;
  return (
    <div style={{ display: "flex", position: "relative", width: AREA.width, height: AREA.height }}>
      <svg
        width={AREA.width}
        height={AREA.height}
        viewBox={`0 0 ${AREA.width} ${AREA.height}`}
        style={{ position: "absolute", left: 0, top: 0 }}
        aria-hidden="true"
      >
        {drawOrder(people).map((i) => {
          const person = people[i];
          if (!person) return null;
          const y = rows[i] ?? ringY;
          const faded = anyFavored && !person.favored;
          return (
            <path
              key={`line-${String(i)}`}
              d={`M ${START_X} ${y} H ${RING_X - 170} C ${RING_X - 80} ${y}, ${RING_X - 80} ${ringY}, ${RING_X} ${ringY}`}
              fill="none"
              stroke={personHex(i)}
              strokeOpacity={faded ? 0.3 : 1}
              strokeWidth={person.favored ? LINE_WIDTH + 6 : LINE_WIDTH}
              strokeLinecap="round"
            />
          );
        })}
        {people.map((person, i) => (
          <circle
            key={`start-${String(i)}`}
            cx={START_X}
            cy={rows[i] ?? ringY}
            r={person.favored ? 16 : 13}
            fill={OG_COLORS.surface}
            stroke={personHex(i)}
            strokeOpacity={anyFavored && !person.favored ? 0.3 : 1}
            strokeWidth={8}
          />
        ))}
        <circle cx={RING_X} cy={ringY} r={44} fill={OG_COLORS.surface} stroke={OG_COLORS.ink} strokeWidth={18} />
      </svg>
      {people.map((person, i) => (
        <div
          key={`label-${String(i)}`}
          style={{
            display: "flex",
            position: "absolute",
            left: START_X - 12,
            top: (rows[i] ?? ringY) - 64,
            alignItems: "baseline",
            gap: 10,
            color: anyFavored && !person.favored ? OG_COLORS.muted : OG_COLORS.ink,
          }}
        >
          <span style={{ fontSize: 32, color: anyFavored && !person.favored ? OG_COLORS.muted : OG_COLORS.inkSoft }}>
            {person.name}
          </span>
          <span style={{ fontSize: 38 }}>{minutesText(person.minutes)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * 공유 링크(`/s?...`)와 방 링크(`/r/<id>?sv=`) 미리보기: 왼쪽에 "{1위역}에서 볼까?"(정한 역은 "에서 만나요")와 최장·차이, 오른쪽에 각자의 노선이 그 역으로 모이는 그림. 요청 때 만든다.
 * 카카오 말풍선(약 270px 폭)에서도 역 이름과 색 노선이 읽히게 크게 그린다. 노선 길이는 사람마다 같다(길이로 시간을 읽게 하지 않는다).
 */
export function SharedCard({ data }: { data: SharedCardData }) {
  const computed = summary(data.people);
  const lines = data.footer ?? {
    main: computed?.longest ?? null,
    sub: computed ? `${computed.spread} ${OG_TEXT.middleDot} ${data.modeLine}` : data.modeLine,
  };
  return (
    <OgFrame>
      <div style={{ display: "flex", flex: 1 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 552, paddingRight: 16 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: "auto",
              marginBottom: "auto",
              lineHeight: 1.02,
            }}
          >
            <span style={{ fontSize: headlineSize(data.stationName), letterSpacing: -6 }}>{data.stationName}</span>
            <span style={{ fontSize: 80, letterSpacing: -3 }}>{data.suffix ?? OG_TEXT.sharedSuffix}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {lines.main ? <span style={{ fontSize: 40, color: OG_COLORS.inkSoft }}>{lines.main}</span> : null}
            {/* 한국어도 낱말 단위로 줄을 바꾼다("저녁"이 "저/녁"으로 갈리지 않게). */}
            <span style={{ fontSize: 30, color: OG_COLORS.muted, wordBreak: "keep-all" }}>{lines.sub}</span>
          </div>
        </div>
        <Lines people={data.people} />
      </div>
    </OgFrame>
  );
}
