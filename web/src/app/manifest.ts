import type { MetadataRoute } from "next";
import { appManifest } from "@/lib/seo/app-manifest";

/** `/manifest.webmanifest`(정적으로 만든다). 값은 src/lib/seo/app-manifest.ts. */
export default function manifest(): MetadataRoute.Manifest {
  return appManifest();
}
