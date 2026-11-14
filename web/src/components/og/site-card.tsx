import { OG_COLORS, OG_TEXT } from "@/lib/seo/og-text";
import { OgFrame } from "./frame";

/** 사이트 기본 미리보기. 홈과, 링크 결과를 못 가져왔을 때의 대체 이미지. */
export function SiteCard() {
  return (
    <OgFrame>
      <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 104, lineHeight: 1.12, letterSpacing: -3 }}>
          <span>{OG_TEXT.taglineTop}</span>
          <span>{OG_TEXT.taglineBottom}</span>
        </div>
        <div style={{ display: "flex", fontSize: 44, color: OG_COLORS.inkSoft }}>{OG_TEXT.taglineSub}</div>
      </div>
    </OgFrame>
  );
}
