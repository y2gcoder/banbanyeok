/**
 * 진짜 iOS Safari(Xcode 시뮬레이터)에서 여는 괄호 "(" 줄 끝 고립을 잰다. 배경과 결과: docs/setup/w2-paren-notes.md.
 * 데스크톱 WebKit(Playwright)은 이 문제를 재현하지 못해 시뮬레이터가 유일한 재현 수단이다(CI에서는 돌리지 않는다, 수동 점검용).
 *
 * 사용(맥 + Xcode):
 *   1) 시뮬레이터를 켠다: `xcrun simctl boot "iPhone 17"` (이미 켜져 있어야 한다. 처음 켜면 1분쯤 걸린다)
 *   2) 웹을 통계 키를 넣어 빌드해 띄운다(배너가 떠야 배너 문구도 잰다):
 *      `NEXT_PUBLIC_POSTHOG_KEY=phc_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345 NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com pnpm build && pnpm start --port 3100`
 *   3) `node scripts/ios-sim-line-break.ts [웹 주소] [경로,경로]` (기본 http://127.0.0.1:3100, /privacy,/)
 *
 * 이 스크립트는 웹 앞에 작은 프록시를 세워 HTML에 측정 코드를 넣고, 시뮬레이터 Safari로 그 주소를 연 뒤 결과를 받는다
 * (화면 폭 320~440px을 2px씩 바꿔 가며 "("가 줄 끝에 홀로 남은 곳을 센다). 하나라도 있으면 종료 코드 1.
 */
import { spawnSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { orphanedOpenParens } from "../e2e/support/line-break.ts";

const [, , baseArg, pathsArg] = process.argv;
const base = baseArg ?? "http://127.0.0.1:3100";
const paths = (pathsArg ?? "/privacy,/").split(",");
const RESULT_PATH = "/__line-break-result";
const TIMEOUT_MS = 120_000;

type Result = { path: string; userAgent: string; viewport: number; byWidth: Record<number, string[]> };

/** 페이지에 넣는 코드: 글꼴을 기다린 뒤 폭을 바꿔 가며 잰다. */
const probe = `
${orphanedOpenParens.toString()}
addEventListener("load", async () => {
  await document.fonts.ready;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const byWidth = {};
  for (let width = 320; width <= 440; width += 2) {
    document.body.style.width = width + "px";
    byWidth[width] = orphanedOpenParens("body");
  }
  await fetch(${JSON.stringify(RESULT_PATH)}, {
    method: "POST",
    body: JSON.stringify({ path: location.pathname, userAgent: navigator.userAgent, viewport: innerWidth, byWidth }),
  });
});
`;

const results: Result[] = [];

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === RESULT_PATH && req.method === "POST") {
    results.push(JSON.parse(await readBody(req)) as Result);
    res.end("ok");
    return;
  }
  const upstream = await fetch(new URL(req.url ?? "/", base), { headers: { accept: req.headers.accept ?? "*/*" } });
  const type = upstream.headers.get("content-type") ?? "";
  let body = Buffer.from(await upstream.arrayBuffer());
  if (type.includes("text/html")) {
    body = Buffer.from(body.toString("utf8").replace("</body>", () => `<script>${probe}</script></body>`));
  }
  res.writeHead(upstream.status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    res.statusCode = 502;
    res.end(String(error));
  });
});
await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
const port = (server.address() as AddressInfo).port;

let failed = false;
for (const path of paths) {
  const before = results.length;
  const open = spawnSync("xcrun", ["simctl", "openurl", "booted", `http://127.0.0.1:${port}${path}?t=${Date.now()}`]);
  if (open.status !== 0) {
    process.stderr.write(`simctl openurl 실패(시뮬레이터가 켜져 있나요?): ${open.stderr.toString()}\n`);
    process.exit(2);
  }
  const deadline = Date.now() + TIMEOUT_MS;
  while (results.length === before && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 500));
  const result = results[before];
  if (!result) {
    process.stderr.write(`${path}: 시간 안에 결과를 받지 못했어요.\n`);
    failed = true;
    continue;
  }
  const bad = Object.entries(result.byWidth).filter(([, found]) => found.length > 0);
  const worst = Math.max(0, ...bad.map(([, found]) => found.length));
  process.stdout.write(
    `${path} (기준 폭 ${result.viewport}px, ${result.userAgent.match(/Version\/[\d.]+/)?.[0] ?? "?"}): ` +
      `${Object.keys(result.byWidth).length}개 폭 중 ${bad.length}개에서 "(" 고립, 한 폭에서 최대 ${worst}곳\n`,
  );
  for (const [width, found] of bad.slice(0, 3))
    process.stdout.write(`  ${width}px: ${found.slice(0, 3).join(" | ")}\n`);
  if (bad.length > 0) failed = true;
}
server.close();
process.exit(failed ? 1 : 0);
