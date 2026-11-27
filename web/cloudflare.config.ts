// vinext 비교 실험(#254) 전용 Worker 설정. 운영 배포(wrangler.jsonc, deploy-web.yml)는 이 파일을 읽지 않는다.
// 이름은 운영 Worker(banbanyeok-web)와 다르게 두고 domains는 넣지 않는다. vinext 배포는 custom domain을 묻지 않고 옮기기 때문이다.
// 값은 wrangler.jsonc의 vars·flags와 같은 이름이다. API_ORIGIN·CANONICAL_HOST는 빌드할 때 환경 변수에서 읽고, 비밀은 secret으로만 둔다.
import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: process.env.VINEXT_WORKER_NAME ?? "banbanyeok-web-vinext",
    entrypoint: "./vinext/worker.ts",
    compatibilityDate: "2026-11-01", // wrangler.jsonc와 같다. init이 쓴 오늘 날짜는 7일 규칙을 따른 workerd(2026-11-26까지)가 거절한다
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    workersDev: true,
    observability: { enabled: true },
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      API_ORIGIN: bindings.text(process.env.API_ORIGIN ?? ""),
      CANONICAL_HOST: bindings.text(process.env.CANONICAL_HOST ?? ""),
      PROXY_SHARED_SECRET: bindings.secret(),
    },
  }),
});
