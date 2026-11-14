import type { MetadataRoute } from "next";
import { loadSeoSite } from "@/lib/seo/load";
import { sitemapEntries } from "@/lib/seo/site-map";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapEntries(loadSeoSite());
}
