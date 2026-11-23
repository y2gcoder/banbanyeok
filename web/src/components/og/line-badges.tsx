import { OG_COLORS, OG_TEXT } from "@/lib/copy/og-text";
import { stationByCode } from "@/lib/stations";
import { lineColor, lineShortLabel, lineTextColor } from "@/lib/stations/lines";

/** 화면 LineBadge와 같은 순서·원/캡슐 모양. 고정 폭 그림에서는 앞 3개만 그리고 나머지는 '외 n'. */
export function OgLineBadges({
  stationCode,
  lines,
  size = 36,
}: {
  stationCode?: string | undefined;
  lines?: readonly string[];
  size?: number;
}) {
  const all = lines ?? (stationCode ? stationByCode(stationCode)?.lines : undefined) ?? [];
  if (all.length === 0) return null;
  const visible = all.slice(0, 3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, height: size, flexShrink: 0 }}>
      {visible.map((line) => {
        const label = lineShortLabel(line);
        return (
          <div
            key={line}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              height: size,
              minWidth: size,
              ...(label.length === 1 ? { width: size } : {}),
              padding: label.length === 1 ? 0 : "0 10px",
              borderRadius: size,
              backgroundColor: lineColor(line),
              color: lineTextColor(line),
              fontSize: Math.round(size * 0.55),
              lineHeight: 1,
            }}
          >
            {label}
          </div>
        );
      })}
      {all.length > visible.length ? (
        <span
          style={{ fontSize: Math.round(size * 0.6), color: OG_COLORS.muted }}
        >{`${OG_TEXT.moreLines}${all.length - visible.length}`}</span>
      ) : null}
    </div>
  );
}
