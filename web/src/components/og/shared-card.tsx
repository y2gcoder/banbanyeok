import { OG_COLORS, OG_TEXT } from "@/lib/copy/og-text";
import { formatMinutes } from "@/lib/display/minutes";
import type { SharedCardData } from "@/lib/share-card/shared-preview";
import { BarTrack, emWidth, fitName, Words } from "./bars";
import { Dot, OgFrame, personHex } from "./frame";
import { OgLineBadges } from "./line-badges";

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
  return Math.min(132, Math.floor(540 / (length * 0.95)));
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
function Lines({ people, teaser = false }: { people: SharedCardData["people"]; teaser?: boolean }) {
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
      {teaser ? (
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: RING_X - 44,
            top: ringY - 44,
            width: 88,
            height: 88,
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
            color: OG_COLORS.ink,
          }}
        >
          {OG_TEXT.drawTeaserMark}
        </div>
      ) : null}
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
          {teaser ? null : <span style={{ fontSize: 38 }}>{minutesText(person.minutes)}</span>}
        </div>
      ))}
      {/* 막차 줄(#62): 각자의 노선 바로 아래, 작게. 시각을 모르거나 출발역을 숨긴 사람은 줄이 없다. */}
      {people.map((person, i) =>
        person.lastTrain ? (
          <div
            key={`last-${String(i)}`}
            style={{
              display: "flex",
              position: "absolute",
              left: START_X + 26,
              top: (rows[i] ?? ringY) + 12,
              fontSize: 24,
              color: OG_COLORS.muted,
            }}
          >
            {person.lastTrain}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** 막대 한 사람 칸: 이름·분 한 줄, 막대, 막차 한 줄(있을 때). 인원이 많으면 그림 영역 높이에 맞춰 함께 줄인다. */
const BAR_UNIT = { label: 44, bar: 22, lastTrain: 30, inner: 6, gap: 22 } as const;

/**
 * 반반지수(#202): 노선 그림 대신 사람마다 이름·분과 같은 축(가장 오래 걸리는 사람 = 끝)의 막대. 막차는 막대 아래 작게 둔다.
 * 이름은 분 글자를 뺀 폭에 맞추고, 넘치면 끝(서버가 붙인 번호)을 남기고 가운데를 줄인다.
 */
function Bars({ people }: { people: SharedCardData["people"] }) {
  const hasLastTrain = people.some((p) => p.lastTrain);
  const unit =
    BAR_UNIT.label + BAR_UNIT.inner + BAR_UNIT.bar + (hasLastTrain ? BAR_UNIT.inner + BAR_UNIT.lastTrain : 0);
  const scale = Math.min(1, AREA.height / (people.length * unit + (people.length - 1) * BAR_UNIT.gap));
  const axis = Math.max(...people.map((p) => p.minutes ?? 0));
  const minutesSize = Math.floor(38 * scale);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: Math.floor(BAR_UNIT.gap * scale),
        width: AREA.width,
        height: AREA.height,
      }}
    >
      {people.map((person, i) => {
        const minutes = minutesText(person.minutes);
        const dot = Math.floor(22 * scale);
        const nameRoom = AREA.width - dot - 12 - Math.ceil(emWidth(minutes) * minutesSize) - 16;
        const name = fitName(person.name, nameRoom, Math.floor(32 * scale), Math.floor(24 * scale));
        return (
          <div
            key={`bar-${String(i)}`}
            style={{ display: "flex", flexDirection: "column", gap: Math.floor(BAR_UNIT.inner * scale) }}
          >
            <div style={{ display: "flex", alignItems: "center", height: Math.floor(BAR_UNIT.label * scale), gap: 12 }}>
              <Dot color={personHex(i)} size={dot} />
              <span style={{ fontSize: name.size, color: OG_COLORS.inkSoft, whiteSpace: "nowrap" }}>{name.text}</span>
              <span style={{ fontSize: minutesSize, marginLeft: "auto", whiteSpace: "nowrap" }}>{minutes}</span>
            </div>
            <div style={{ display: "flex" }}>
              <BarTrack index={i} minutes={person.minutes ?? 0} axis={axis} height={Math.floor(BAR_UNIT.bar * scale)} />
            </div>
            {hasLastTrain ? (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  height: Math.floor(BAR_UNIT.lastTrain * scale),
                  fontSize: Math.floor(24 * scale),
                  color: OG_COLORS.muted,
                }}
              >
                {person.lastTrain ?? ""}
              </div>
            ) : null}
          </div>
        );
      })}
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
  const banban = data.banban;
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
            <div style={{ display: "flex", marginBottom: 14 }}>
              <OgLineBadges stationCode={data.stationCode} />
            </div>
            <span style={{ fontSize: headlineSize(data.stationName), letterSpacing: -6 }}>{data.stationName}</span>
            <span style={{ fontSize: 80, letterSpacing: -3 }}>{data.suffix ?? OG_TEXT.sharedSuffix}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {banban ? (
              <div
                style={{
                  display: "flex",
                  alignSelf: "flex-start",
                  lineHeight: 1.25,
                  color: OG_COLORS.ink,
                  ...(banban.kind === "close"
                    ? { backgroundColor: OG_COLORS.safety, padding: "2px 12px", borderRadius: 8 }
                    : {}),
                }}
              >
                <Words text={banban.text} size={34} />
              </div>
            ) : lines.main ? (
              <span style={{ fontSize: 40, color: OG_COLORS.inkSoft }}>{lines.main}</span>
            ) : null}
            {/* 한국어도 낱말 단위로 줄을 바꾼다("저녁"이 "저/녁"으로 갈리지 않게). */}
            <span style={{ fontSize: 30, color: OG_COLORS.muted, wordBreak: "keep-all" }}>
              {banban ? data.modeLine : lines.sub}
            </span>
            {/* 지도 한가운데 비교(#68 2단계): 방 미리보기 1위 단계에서 조건을 채울 때만. */}
            {data.middleLine ? (
              <span style={{ fontSize: 30, color: OG_COLORS.inkSoft, wordBreak: "keep-all" }}>{data.middleLine}</span>
            ) : null}
          </div>
        </div>
        {banban ? <Bars people={data.people} /> : <Lines people={data.people} teaser={data.teaser ?? false} />}
      </div>
    </OgFrame>
  );
}
