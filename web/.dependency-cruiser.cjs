/**
 * 계층 규칙: app/ → components/ → lib/ (반대 방향 금지). 서버 호출(openapi-fetch, 생성된 계약 타입의 직접 사용)은 lib/api만.
 * lib/ 안의 패키지(디렉터리) 의존 방향도 한쪽으로만 흐른다(아래 `lib-*` 규칙). 패키지 단위 순환은 depcruise 규칙으로 표현할 수 없어
 * `scripts/check-package-cycles.ts`가 따로 검사한다(lib/·components/ 디렉터리를 한 점으로 묶은 그래프에 순환 0).
 * 실행: pnpm lint (depcruise src + 그 스크립트).
 *
 * 화면 디렉터리(components/home·room·result)는 서로를 import하지 않는다(`screens-are-independent`). 같이 쓰는 조각은 common·ui·when·share나
 * result/parts에 둔다(둘 다 화면이 아니라 조각 묶음이라 어느 화면이든 쓸 수 있다).
 *
 * lib/ 안의 방향(아래가 잎): seo → room → share-card → result → {share, link} → when → api → proxy, 모두가 copy(잎)를 본다.
 */
// 기존 copy·api·when 규칙 외에도 모든 lib 패키지는 명시한 내부 의존만 허용한다.
// 새 패키지는 아래 목록에 추가하며 허용할 방향을 함께 검토한다. 테스트는 실제 구현을 조합할 수 있다.
const libDependencies = {
  analytics: ["room"],
  display: ["api"],
  form: ["api", "link", "stations", "when"],
  link: ["api", "when"],
  map: [],
  problems: [],
  proxy: ["problems"],
  result: ["api", "copy", "display", "link", "map", "share", "stations", "when"],
  room: ["api", "copy", "display", "link", "result", "share", "share-card", "stations", "when"],
  security: ["share"],
  seo: ["api", "copy", "display", "link", "result", "room", "stations", "when"],
  share: ["copy"],
  "share-card": ["api", "copy", "display", "link", "result", "when"],
  stations: [],
  text: [],
  utils: [],
  zod: [],
};
// 아래 허용 목록의 공용 잎. zod 자신은 허용 목록 규칙으로 다른 lib를 모른다.
const commonLibLeaves = ["^src/lib/zod\\.ts$"];
const libPath = (packages) => `^src/lib/(${packages.join("|")})(?:/|\\.ts$)`;

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
      name: "screens-are-independent",
      comment:
        "화면 디렉터리(home·room·result)는 서로의 파일을 import하지 않는다. 같이 쓰는 조각은 components/common·ui·when·share 또는 result/parts로 옮긴다(허용 목록 밖은 모두 금지).",
      severity: "error",
      from: { path: "^src/components/(home|room|result)/" },
      to: {
        path: "^src/components/(home|room|result)/",
        pathNot: ["^src/components/$1/", "^src/components/result/parts/"],
      },
    },
    {
      name: "shared-components-below-screens",
      comment:
        "공유 조각(og·common·ui·share·when·seo·consent)은 home·room·result 화면과 result/parts를 import하지 않는다.",
      severity: "error",
      from: { path: "^src/components/(og|common|ui|share|when|seo|consent)/" },
      to: { path: "^src/components/(home|room|result)/" },
    },
    {
      name: "result-parts-below-result",
      comment:
        "result/parts(결과·방이 같이 쓰는 조각)는 result의 화면 파일을 모른다. 조각이 화면을 import하면 방 화면이 결과 화면에 묶이던 옛 모양으로 돌아간다.",
      severity: "error",
      from: { path: "^src/components/result/parts/" },
      to: { path: "^src/components/result/", pathNot: "^src/components/result/parts/" },
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
      name: "lib-copy-is-leaf",
      comment:
        "lib/copy(문구·서브셋 글자 제약·그림 버전 상수)는 잎이다. 결과·방·공유·SEO가 모두 이것을 바로 보도록 다른 lib를 import하지 않는다.",
      severity: "error",
      from: { path: "^src/lib/copy/", pathNot: "\\.test\\." },
      to: { path: "^src/lib/", pathNot: "^src/lib/copy/" },
    },
    {
      name: "lib-api-is-leaf",
      comment:
        "lib/api는 proxy 말고는 아무 lib도 모르는 잎이다(링크 코덱의 ShareState 대신 RecommendQuery를 스스로 정의한다).",
      severity: "error",
      from: { path: "^src/lib/api/", pathNot: "\\.test\\." },
      to: { path: "^src/lib/", pathNot: "^src/lib/(api|proxy)/" },
    },
    {
      name: "lib-when-below-link",
      comment: "lib/when(구분·날짜)은 api 타입만 안다. 링크 코덱(lib/link)이 when을 쓰는 방향으로만 흐른다.",
      severity: "error",
      from: { path: "^src/lib/when/", pathNot: "\\.test\\." },
      to: { path: "^src/lib/", pathNot: "^src/lib/(when|api)/" },
    },
    {
      name: "lib-result-below-room-seo",
      comment:
        "결과·공유 문구·공유 그림 값은 방과 SEO를 모른다(방·SEO가 이것들을 쓴다). 문구는 lib/copy, 날짜는 lib/when에서 가져온다.",
      severity: "error",
      from: { path: "^src/lib/(result|share|share-card)/", pathNot: "\\.test\\." },
      to: { path: "^src/lib/(room|seo)/" },
    },
    {
      name: "lib-result-below-share-card",
      comment: "lib/share-card(그림에 그릴 값)는 결과 화면 값을 쓰고, 결과·카카오 공유는 그것을 모른다.",
      severity: "error",
      from: { path: "^src/lib/(result|share)/", pathNot: "\\.test\\." },
      to: { path: "^src/lib/share-card/" },
    },
    {
      name: "lib-seo-is-top",
      comment:
        "lib/seo는 lib 안에서 가장 위다: 방·결과·공유 로직은 SEO(메타데이터·그림 주소·페이지 데이터)를 import하지 않는다.",
      severity: "error",
      from: { path: "^src/lib/", pathNot: ["^src/lib/seo/", "\\.test\\."] },
      to: { path: "^src/lib/seo/" },
    },
    ...Object.entries(libDependencies).map(([name, dependencies]) => ({
      name: `lib-${name}-allowed-dependencies`,
      comment: `lib/${name}는 자기 패키지·공용 잎과 허용 목록(${dependencies.join(", ") || "없음"})만 import한다.`,
      severity: "error",
      from: { path: libPath([name]), pathNot: "\\.test\\." },
      to: { path: "^src/lib/", pathNot: [libPath([name, ...dependencies]), ...commonLibLeaves] },
    })),
    {
      name: "lib-package-needs-direction-rule",
      comment: "새 lib 패키지가 다른 lib를 쓰려면 허용 목록에 방향을 먼저 기록한다.",
      severity: "error",
      from: {
        path: "^src/lib/",
        pathNot: [libPath(["copy", "api", "when", ...Object.keys(libDependencies)]), "\\.test\\."],
      },
      to: { path: "^src/lib/" },
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
