/**
 * 계층 규칙: app/ → components/ → lib/ (반대 방향 금지). 서버 호출(openapi-fetch, 생성된 계약 타입의 직접 사용)은 lib/api만.
 * 실행: pnpm lint (depcruise src).
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "lib-is-leaf",
      comment: "lib/는 화면을 모른다. components/·app/을 import하지 않는다.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/(components|app)/" },
    },
    {
      name: "components-not-app",
      comment: "components/는 app/(라우트)을 import하지 않는다.",
      severity: "error",
      from: { path: "^src/components/" },
      to: { path: "^src/app/" },
    },
    {
      name: "api-client-only-in-lib-api",
      comment: "openapi-fetch로 서버를 부르는 곳은 src/lib/api 하나다.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/lib/api/" },
      to: { path: "openapi-fetch" },
    },
    {
      name: "generated-schema-only-in-lib-api",
      comment: "생성된 계약 타입은 src/lib/api/types.ts가 이름을 붙여 내보낸다.",
      severity: "error",
      from: { path: "^src/", pathNot: "^src/lib/api/" },
      to: { path: "^src/lib/api/schema\\.gen\\.ts$" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "error",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "^src/app/", "\\.test\\.tsx?$"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "\\.gen\\.json$" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
