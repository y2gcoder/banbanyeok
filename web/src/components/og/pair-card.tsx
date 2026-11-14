import { formatMinutes } from "@/lib/display/minutes";
import { OG_COLORS, OG_TEXT } from "@/lib/seo/og-text";
import type { PairPage } from "@/lib/seo/pair-pages";
import { Dot, OgFrame, personHex } from "./frame";

/** 두 역 이름의 글자 수에 따라 제목 크기를 줄인다(한 줄에 들어가야 한다). */
function titleSize(page: PairPage): number {
  const length = Array.from(page.first.name + page.second.name).length;
  if (length <= 8) return 96;
  if (length <= 12) return 80;
  if (length <= 16) return 64;
  return 52;
}

/** 조합 페이지(`/meet/<a>-<b>`)의 미리보기. 빌드 때 정적으로 만든다. */
export function PairCard({ page }: { page: PairPage }) {
  const size = titleSize(page);
  return (
    <OgFrame>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 22, fontSize: size, letterSpacing: -2 }}>
        <Dot color={personHex(0)} size={Math.round(size / 3)} />
        <span>{page.first.name}</span>
        <span style={{ color: OG_COLORS.muted }}>{OG_TEXT.middleDot}</span>
        <Dot color={personHex(1)} size={Math.round(size / 3)} />
        <span>{page.second.name}</span>
      </div>
      <div style={{ display: "flex", marginTop: 4, fontSize: 38, color: OG_COLORS.inkSoft }}>
        {OG_TEXT.pairQuestion}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          marginTop: 24,
          borderRadius: 28,
          border: `3px solid ${OG_COLORS.rule}`,
          backgroundColor: OG_COLORS.surface,
        }}
      >
        {page.candidates.map((candidate, i) => (
          <div
            key={candidate.rank}
            style={{
              display: "flex",
              alignItems: "center",
              height: 82,
              padding: "0 28px",
              gap: 20,
              borderTop: i === 0 ? "none" : `2px solid ${OG_COLORS.rule}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 46,
                height: 46,
                borderRadius: 46,
                fontSize: 28,
                backgroundColor: i === 0 ? OG_COLORS.safety : OG_COLORS.surface,
                border: `3px solid ${OG_COLORS.ink}`,
              }}
            >
              {candidate.rank}
            </div>
            <div style={{ display: "flex", flex: 1, fontSize: 44 }}>{candidate.station.name}</div>
            {candidate.people.map((person, index) => (
              <div key={person.stationName} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 36 }}>
                <Dot color={personHex(index)} size={20} />
                <span>{formatMinutes(person.minutes)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", marginTop: "auto", fontSize: 28, color: OG_COLORS.muted }}>
        {OG_TEXT.pairBasis}
      </div>
    </OgFrame>
  );
}
