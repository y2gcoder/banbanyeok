/**
 * sitemap.xml에 넣을 주소. 데이터가 개발용 표본이면 비운다(표본 페이지는 색인하지 않는다).
 * `lastModified`는 데이터 버전의 날짜다(페이지 내용은 데이터가 바뀔 때만 바뀐다).
 */

import type { SeoSite } from "./load";
import { HUB_PATH } from "./metadata";
import { dataVersionDate } from "./pairs";
import { absoluteUrl } from "./site";

type Env = Record<string, string | undefined>;

export type SitemapEntry = { url: string; lastModified: Date };

export function sitemapEntries(
  site: Pick<SeoSite, "source" | "dataVersion" | "pages">,
  env: Env = process.env,
): SitemapEntry[] {
  if (site.source === "fixture") return [];
  const lastModified = new Date(`${dataVersionDate(site.dataVersion).iso}T00:00:00Z`);
  return ["/", HUB_PATH, ...site.pages.map((page) => page.path)].map((path) => ({
    url: absoluteUrl(path, env),
    lastModified,
  }));
}

/** robots.txt 규칙. 색인해도 되는 배포(`isIndexable`)가 아니면 전부 막는다. */
export function robotsRules(isIndexable: boolean, env: Env = process.env) {
  if (!isIndexable) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: absoluteUrl("/sitemap.xml", env),
  };
}
