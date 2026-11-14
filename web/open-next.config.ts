// OpenNext Cloudflare 빌드 설정(pnpm cf:build). 증분 캐시는 아직 쓰지 않는다(P8 배포에서 정한다).
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig();
