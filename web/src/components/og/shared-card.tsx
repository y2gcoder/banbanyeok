import { formatMinutes } from "@/lib/display/minutes";
import { OG_COLORS, OG_TEXT } from "@/lib/seo/og-text";
import { OgFrame, personHex } from "./frame";

export type SharedCardData = {
  stationName: string;
  /** 글꼴에 있는 글자만으로 정리된 이름(`ogSafeName`)과 표시 분. 입력 순서. */
  people: { name: string; minutes: number }[];
  modeLine: string;
};

const BAR_MAX = 520;

function headlineSize(stationName: string): number {
  const length = Array.from(stationName).length;
  if (length <= 5) return 104;
  if (length <= 8) return 88;
  return 68;
}

/** 공유 링크(`/s?...`) 미리보기: "{1위역}에서 볼까?"와 사람별 시간. 요청 때 만든다. */
export function SharedCard({ data }: { data: SharedCardData }) {
  const longest = Math.max(...data.people.map((p) => p.minutes), 1);
  return (
    <OgFrame>
      <div
        style={{
          display: "flex",
          marginTop: 22,
          fontSize: headlineSize(data.stationName),
          letterSpacing: -3,
          lineHeight: 1.1,
        }}
      >
        {data.stationName}
        {OG_TEXT.sharedSuffix}
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 26, gap: 14 }}>
        {data.people.map((person, index) => (
          <div key={person.name + String(index)} style={{ display: "flex", alignItems: "center", gap: 20, height: 62 }}>
            <div style={{ display: "flex", width: 230, fontSize: 38 }}>{person.name}</div>
            <div style={{ display: "flex", alignItems: "center", width: BAR_MAX, height: 26 }}>
              <div
                style={{
                  display: "flex",
                  height: 18,
                  borderRadius: 18,
                  width: Math.max(Math.round((person.minutes / longest) * BAR_MAX), 32),
                  backgroundColor: personHex(index),
                }}
              />
            </div>
            <div style={{ display: "flex", fontSize: 46 }}>{formatMinutes(person.minutes)}</div>
          </div>
        ))}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: "auto",
          justifyContent: "space-between",
          fontSize: 30,
          color: OG_COLORS.muted,
        }}
      >
        <span>{data.modeLine}</span>
        <span>{OG_TEXT.sharedCandidates}</span>
      </div>
    </OgFrame>
  );
}
