/**
 * vinext 빌드에서만 `@opennextjs/cloudflare`를 이 파일로 바꾼다(vite.config.ts alias). vinext는 getCloudflareContext()를 구현하지
 * 않으므로, 앱 코드(src/lib/seo/og-font.ts)를 고치지 않고 같은 모양의 값을 `cloudflare:workers`에서 준다. Worker 밖(빌드 때
 * 사전 렌더)에서 env를 읽으면 던지는데, 호출하는 쪽이 try/catch로 파일 읽기로 넘어간다.
 */
import { env } from "cloudflare:workers";

export function getCloudflareContext() {
  return { env };
}
