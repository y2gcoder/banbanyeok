import type { Mode } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/seo/og-text";

/**
 * 어떤 기준으로 골랐는지 한 마디: "공평하게 고름" / "가장 빠른 만남으로 고름" / "{짧은 이름} 쪽으로 고름".
 * 미리보기(설명·그림)와 공유 버튼 문구가 같은 말을 쓴다. 탭 이름("공평하게")에 "로 고름"을 붙이면 말이 어긋나므로 탭 이름을 쓰지 않는다.
 */
export function modeSentence(mode: Mode, favorName: string | null): string {
  switch (mode) {
    case "fair":
      return OG_TEXT.modeFair;
    case "fast":
      return OG_TEXT.modeFast;
    case "favor":
      return `${favorName ?? ""}${OG_TEXT.modeFavorSuffix}`.trim();
  }
}
