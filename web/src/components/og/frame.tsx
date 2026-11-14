import type { CSSProperties, ReactNode } from "react";
import { OG_COLORS, OG_FONT_FAMILY, OG_HEIGHT, OG_TEXT, OG_WIDTH } from "@/lib/seo/og-text";

/*
 * 미리보기(OG) 이미지 공통 틀. satori(next/og)가 그리므로 CSS 변수·그리드를 못 쓰고, 여러 자식이 있는 요소는 모두 flex여야 한다.
 * 글꼴은 서브셋 하나(Bold)뿐이라 모든 글자를 700으로 쓴다.
 */
const ogRoot: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: OG_WIDTH,
  height: OG_HEIGHT,
  backgroundColor: OG_COLORS.platform,
  color: OG_COLORS.ink,
  fontFamily: OG_FONT_FAMILY,
  fontWeight: 700,
};

/** 반반 나뉜 원(사이트 워드마크와 같은 모양) + 이름. */
function Brand() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 38 }}>
      <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill={OG_COLORS.surface} stroke={OG_COLORS.ink} strokeWidth="3" />
        <path d="M12 2a10 10 0 0 1 0 20z" fill={OG_COLORS.ink} />
      </svg>
      <span>{OG_TEXT.brand}</span>
    </div>
  );
}

export function OgFrame({ children }: { children: ReactNode }) {
  return (
    <div style={ogRoot}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "40px 64px 30px" }}>
        <Brand />
        {children}
      </div>
      {/* 승강장 안전선 */}
      <div style={{ display: "flex", height: 18, backgroundColor: OG_COLORS.safety }} />
    </div>
  );
}

/** 사람(또는 출발역) 색 점. */
export function Dot({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size,
        border: `${Math.round(size / 4)}px solid ${color}`,
        backgroundColor: OG_COLORS.surface,
      }}
    />
  );
}

export function personHex(index: number): string {
  return OG_COLORS.people[index % OG_COLORS.people.length] ?? OG_COLORS.ink;
}
