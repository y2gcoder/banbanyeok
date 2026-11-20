/**
 * 패키지 단위 순환 검사. dependency-cruiser의 `circular`는 파일 단위 순환만 잡는다. 파일끼리는 순환이 없어도 디렉터리(패키지)끼리
 * 서로 import하면(예: result → seo → room → result) 한 패키지를 고치려면 나머지를 다 읽어야 한다. 그 모양을 막는다.
 *
 * 그래프: `src/(lib|components)/<디렉터리>`를 한 점으로, `src/app`을 한 점으로 묶고, 그 밖의 파일(`lib/utils.ts` 등)은 파일 하나가 한 점이다.
 * 테스트·`*.cases.ts`는 뺀다(`scripts/architecture-metrics.sh`의 `web_package_cycles` 지표와 같은 정의다). 점 두 개 이상이 서로 닿는
 * 강한 연결 요소(SCC)가 하나라도 있으면 실패하고, 순환을 이루는 패키지와 그 사이의 파일 간선을 적는다.
 *
 * 사용: pnpm check:package-cycles  (pnpm lint에 들어 있다)
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Dependency = { resolved: string; dependencyTypes: string[] };
type Module = { source: string; dependencies: Dependency[] };

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = spawnSync(
  "pnpm",
  ["exec", "depcruise", "src", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
  { cwd: web, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);
// 규칙 위반(error)이 있으면 depcruise는 0이 아닌 코드로 끝나지만 보고서는 나온다. 위반은 `depcruise src`가 따로 알린다.
let modules: Module[];
try {
  modules = (JSON.parse(run.stdout) as { modules: Module[] }).modules;
} catch {
  console.error(`dependency-cruiser 출력을 읽지 못했다.\n${run.stderr}`);
  process.exit(2);
}

const isTest = (path: string) => /\.test\.|\.cases\./.test(path);

function packageOf(path: string): string {
  if (/^src\/(lib|components)\/[^/]+\//.test(path)) return path.split("/").slice(0, 3).join("/");
  if (path.startsWith("src/app/")) return "src/app";
  return path;
}

const product = modules.filter((m) => m.source.startsWith("src/") && !isTest(m.source));
const edges = new Map<string, Map<string, Set<string>>>(); // 패키지 → 패키지 → "from → to" 파일 간선
for (const m of product) {
  for (const d of m.dependencies) {
    if (!d.dependencyTypes.includes("local") || !d.resolved.startsWith("src/") || isTest(d.resolved)) continue;
    const from = packageOf(m.source);
    const to = packageOf(d.resolved);
    if (from === to) continue;
    const targets = edges.get(from) ?? new Map<string, Set<string>>();
    const files = targets.get(to) ?? new Set<string>();
    files.add(`${m.source} → ${d.resolved}`);
    targets.set(to, files);
    edges.set(from, targets);
  }
}

/** Tarjan 강한 연결 요소. */
function components(graph: Map<string, Map<string, Set<string>>>): string[][] {
  const nodes = new Set<string>([...graph.keys(), ...[...graph.values()].flatMap((t) => [...t.keys()])]);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const found: string[][] = [];
  let counter = 0;

  const visit = (node: string) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node)?.keys() ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node) ?? 0, index.get(next) ?? 0));
      }
    }
    if (low.get(node) === index.get(node)) {
      const members: string[] = [];
      for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
        onStack.delete(top);
        members.push(top);
        if (top === node) break;
      }
      if (members.length > 1) found.push(members.sort());
    }
  };
  for (const node of [...nodes].sort()) if (!index.has(node)) visit(node);
  return found.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

const cycles = components(edges);
if (cycles.length === 0) {
  process.stdout.write(`✔ 패키지 단위 순환 없음 (${product.length}개 제품 모듈)\n`);
} else {
  console.error(`✘ 패키지 단위 순환 ${cycles.length}개`);
  for (const members of cycles) {
    console.error(`\n  ${members.join(" ⇄ ")}`);
    for (const from of members) {
      for (const [to, files] of edges.get(from) ?? []) {
        if (members.includes(to)) for (const file of [...files].sort()) console.error(`    ${file}`);
      }
    }
  }
  console.error(
    "\n한쪽 방향으로만 흐르게 문구는 lib/copy, 날짜는 lib/when처럼 아래 패키지로 내리거나 import를 거꾸로 돌린다.",
  );
  process.exit(1);
}
