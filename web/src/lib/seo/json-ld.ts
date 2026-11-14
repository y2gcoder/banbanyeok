/**
 * 구조화 데이터(JSON-LD)는 빵부스러기(BreadcrumbList)만 쓴다. 후기·FAQ·평점 같은 근거 없는 마크업은 넣지 않는다.
 */
import { absoluteUrl } from "./site";

type Env = Record<string, string | undefined>;

export function breadcrumbJsonLd(items: readonly { name: string; path: string }[], env: Env = process.env) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path, env),
    })),
  };
}

/** `<script type="application/ld+json">` 안에 넣을 문자열. `<`를 이스케이프해 `</script>`로 빠져나가지 못하게 한다. */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replaceAll("<", "\\u003c");
}
