import type { MetadataRoute } from "next";
import { isIndexableSite } from "@/lib/seo/site";
import { robotsRules } from "@/lib/seo/site-map";

export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return robotsRules(isIndexableSite());
}
