/**
 * 배포된 Worker의 요청당 CPU·벽시계 시간 실측(.github/workflows/deploy-web.yml의 measure 단계가 부른다).
 * `wrangler tail --format json`을 띄워 놓고 주요 경로를 반복 요청한 뒤, 경로별 cpuTime·wallTime(밀리초)의 중앙값·p90·최대를 표로 낸다.
 * 무료 플랜의 한도는 요청당 CPU 10ms다. 첫 요청(콜드 isolate)은 따로 적는다.
 *
 *   BASE_URL=https://example.com WORKER_NAME=banbanyeok-web node scripts/measure-cpu.ts   (CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID 필요)
 */
import { type ChildProcess, spawn } from "node:child_process";

const base = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const worker = process.env.WORKER_NAME ?? "banbanyeok-web";
const repeats = Number(process.env.REPEATS ?? 15);
if (!base) throw new Error("BASE_URL이 필요합니다");

type TailEvent = {
  cpuTime?: number;
  wallTime?: number;
  outcome?: string;
  event?: { request?: { url?: string }; response?: { status?: number } };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const events: TailEvent[] = [];
const out = (text: string) => process.stdout.write(`${text}\n`);

function startTail(): ChildProcess {
  const child = spawn("pnpm", ["exec", "wrangler", "tail", worker, "--format", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buffer = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("{")) continue;
      try {
        events.push(JSON.parse(line) as TailEvent);
      } catch {
        // 잘린 줄은 무시
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  return child;
}

async function firstPairPath(): Promise<string> {
  const text = await (await fetch(`${base}/sitemap.xml`)).text();
  const match = /<loc>[^<]*(\/meet\/[^<]+)<\/loc>/.exec(text);
  if (!match?.[1]) throw new Error("sitemap.xml에서 조합 주소를 찾지 못했습니다");
  return match[1];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

const fmt = (value: number) => (Number.isNaN(value) ? "-" : value.toFixed(1));

async function main() {
  const pair = await firstPairPath();
  const codes = /\/meet\/([0-9a-z]{3})-([0-9a-z]{3})/.exec(pair);
  const share = codes ? `/s?v=1&o=${codes[1]}.${codes[2]}&m=f` : "/s?v=1&o=zzz.zzz&m=f";
  const ogShare = codes ? `/s/og?v=1&o=${codes[1]}.${codes[2]}&m=f` : "/s/og?v=1&o=zzz.zzz&m=f";
  const paths = ["/", "/privacy", "/meet", pair, "/robots.txt", "/sitemap.xml", share, ogShare, "/api/healthz"];

  const tail = startTail();
  await sleep(10_000); // tail 연결 대기
  for (const path of paths) {
    for (let i = 0; i < repeats; i++) {
      const response = await fetch(`${base}${path}`, { redirect: "manual" });
      await response.arrayBuffer();
      await sleep(150);
    }
  }
  await sleep(10_000); // 마지막 이벤트 수신 대기
  tail.kill("SIGINT");

  out(
    `\n| 경로 | 요청 수 | 상태 | CPU 첫 요청 | CPU 중앙값 | CPU p90 | CPU 최대 | 벽시계 중앙값 |\n|---|---|---|---|---|---|---|---|`,
  );
  for (const path of paths) {
    const mine = events.filter((e) => {
      const url = e.event?.request?.url;
      if (!url) return false;
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}` === path;
    });
    const cpu = mine.map((e) => e.cpuTime).filter((v): v is number => typeof v === "number");
    const wall = mine.map((e) => e.wallTime).filter((v): v is number => typeof v === "number");
    const sortedCpu = [...cpu].sort((a, b) => a - b);
    const sortedWall = [...wall].sort((a, b) => a - b);
    const statuses = [...new Set(mine.map((e) => e.event?.response?.status ?? e.outcome))].join("/");
    out(
      `| \`${path.length > 40 ? `${path.slice(0, 37)}...` : path}\` | ${mine.length} | ${statuses || "-"} | ${fmt(cpu[0] ?? Number.NaN)} | ${fmt(percentile(sortedCpu, 50))} | ${fmt(percentile(sortedCpu, 90))} | ${fmt(sortedCpu.at(-1) ?? Number.NaN)} | ${fmt(percentile(sortedWall, 50))} |`,
    );
  }
  out(`\n수신한 tail 이벤트 ${events.length}건(요청 ${paths.length * repeats}건). 단위: ms.`);
  if (events.length > 0) out(`이벤트 키: ${Object.keys(events[0] ?? {}).join(", ")}`);
}

await main();
