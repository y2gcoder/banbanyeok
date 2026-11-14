/**
 * 배포된 Worker의 요청당 CPU·벽시계 시간 실측(.github/workflows/deploy-web.yml의 measure 단계가 부른다).
 * 1) `wrangler tail --format json`을 띄워 놓고 주요 경로를 반복 요청해 경로별 cpuTime·wallTime(ms)의 중앙값·p90·최대를 표로 낸다.
 *    클라이언트가 본 상태 코드도 경로별로 센다(tail은 정적 자산 응답을 싣지 않고 일부 이벤트를 놓칠 수 있다).
 * 2) 계정 분석(GraphQL workersInvocationsAdaptive)에서 같은 기간의 상태별 요청 수와 CPU 분위수를 읽는다(권한이 없으면 건너뛴다).
 * 무료 플랜의 한도는 요청당 CPU 10ms다(초과하면 outcome=exceededCpu, 클라이언트에는 503).
 *
 *   BASE_URL=https://example.com WORKER_NAME=banbanyeok-web node scripts/measure-cpu.ts
 *   (CLOUDFLARE_API_TOKEN·CLOUDFLARE_ACCOUNT_ID 필요. 비밀값은 출력하지 않는다)
 */
import { type ChildProcess, spawn } from "node:child_process";

const base = (process.env.BASE_URL ?? "").replace(/\/+$/, "");
const worker = process.env.WORKER_NAME ?? "banbanyeok-web";
const repeats = Number(process.env.REPEATS ?? 20);
if (!base) throw new Error("BASE_URL이 필요합니다");

type TailEvent = {
  cpuTime?: number;
  wallTime?: number;
  outcome?: string;
  event?: { request?: { url?: string }; response?: { status?: number } };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const out = (text: string) => process.stdout.write(`${text}\n`);
const events: TailEvent[] = [];
let parseFailures = 0;

/** wrangler는 이벤트를 들여쓴 여러 줄 JSON으로 낸다. 문자열·이스케이프를 따라 중괄호 깊이가 0이 되는 곳에서 한 이벤트를 자른다. */
function createEventScanner(onEvent: (text: string) => void) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let current = "";
  return (chunk: string) => {
    for (const ch of chunk) {
      if (depth === 0 && ch !== "{") continue;
      current += ch;
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          onEvent(current);
          current = "";
        }
      }
    }
  };
}

function startTail(): ChildProcess {
  const child = spawn("pnpm", ["exec", "wrangler", "tail", worker, "--format", "json"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const scan = createEventScanner((text) => {
    try {
      events.push(JSON.parse(text) as TailEvent);
    } catch {
      parseFailures += 1;
    }
  });
  child.stdout?.on("data", (chunk: Buffer) => scan(chunk.toString("utf8")));
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
const shorten = (path: string) => (path.length > 40 ? `${path.slice(0, 37)}...` : path);

function countBy(values: (string | number)[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(String(value), (counts.get(String(value)) ?? 0) + 1);
  return [...counts].map(([key, count]) => `${key}×${count}`).join(" ");
}

/** 계정 분석: 같은 기간의 상태별 요청 수와 CPU 분위수(ms). 권한이 없거나 아직 집계 전이면 사유만 적는다. */
async function accountAnalytics(since: Date, until: Date) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) return out("\n계정 분석: 토큰·계정 ID가 없어 건너뜀");
  const query = `query($account: String!, $script: String!, $since: Time!, $until: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      workersInvocationsAdaptive(limit: 50, filter: { scriptName: $script, datetime_geq: $since, datetime_leq: $until }) {
        dimensions { status }
        sum { requests errors }
        quantiles { cpuTimeP50 cpuTimeP90 cpuTimeP99 wallTimeP50 wallTimeP99 }
      }
    } }
  }`;
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { account, script: worker, since: since.toISOString(), until: until.toISOString() },
    }),
  });
  const body = (await response.json()) as {
    data?: {
      viewer?: {
        accounts?: {
          workersInvocationsAdaptive?: {
            dimensions: { status: string };
            sum: { requests: number; errors: number };
            quantiles: Record<string, number>;
          }[];
        }[];
      };
    };
    errors?: { message: string }[];
  };
  const rows = body.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
  if (!rows)
    return out(
      `\n계정 분석: 읽지 못함(HTTP ${response.status}) ${body.errors?.map((e) => e.message).join("; ") ?? ""}`,
    );
  out(
    "\n계정 분석(workersInvocationsAdaptive, 같은 기간, CPU ms):\n| 상태 | 요청 수 | CPU p50 | CPU p90 | CPU p99 | 벽시계 p50 | 벽시계 p99 |\n|---|---|---|---|---|---|---|",
  );
  for (const row of rows) {
    const q = row.quantiles;
    out(
      `| ${row.dimensions.status} | ${row.sum.requests} | ${fmt(q.cpuTimeP50 ?? Number.NaN)} | ${fmt(q.cpuTimeP90 ?? Number.NaN)} | ${fmt(q.cpuTimeP99 ?? Number.NaN)} | ${fmt(q.wallTimeP50 ?? Number.NaN)} | ${fmt(q.wallTimeP99 ?? Number.NaN)} |`,
    );
  }
}

async function main() {
  const pair = await firstPairPath();
  const codes = /\/meet\/([0-9a-z]{3})-([0-9a-z]{3})/.exec(pair);
  const origins = codes ? `${codes[1]}.${codes[2]}` : "zzz.zzz";
  const share = `/s?v=1&o=${origins}&m=f`;
  const ogShare = `/s/og?v=1&o=${origins}&m=f`;
  const paths = ["/", "/privacy", "/meet", pair, "/robots.txt", "/sitemap.xml", share, ogShare, "/api/healthz"];

  const tail = startTail();
  await sleep(12_000); // tail 연결 대기
  const started = new Date();
  const clientStatuses = new Map<string, number[]>();
  for (const path of paths) {
    const seen: number[] = [];
    clientStatuses.set(path, seen);
    for (let i = 0; i < repeats; i++) {
      const response = await fetch(`${base}${path}`, { redirect: "manual" });
      await response.arrayBuffer();
      seen.push(response.status);
      await sleep(300);
    }
  }
  const finished = new Date();
  await sleep(10_000); // 마지막 이벤트 수신 대기
  tail.kill("SIGINT");

  out(
    "\n| 경로 | 요청 수 | 클라이언트 상태 | tail 이벤트 | CPU 첫 이벤트 | CPU 중앙값 | CPU p90 | CPU 최대 | 벽시계 중앙값 |\n|---|---|---|---|---|---|---|---|---|",
  );
  for (const path of paths) {
    const mine = events.filter((e) => {
      const url = e.event?.request?.url;
      if (!url) return false;
      const parsed = new URL(url);
      return parsed.host === new URL(base).host && `${parsed.pathname}${parsed.search}` === path;
    });
    const cpu = mine.map((e) => e.cpuTime).filter((v): v is number => typeof v === "number");
    const wall = mine.map((e) => e.wallTime).filter((v): v is number => typeof v === "number");
    const sortedCpu = [...cpu].sort((a, b) => a - b);
    const sortedWall = [...wall].sort((a, b) => a - b);
    out(
      `| \`${shorten(path)}\` | ${repeats} | ${countBy(clientStatuses.get(path) ?? [])} | ${mine.length} | ${fmt(cpu[0] ?? Number.NaN)} | ${fmt(percentile(sortedCpu, 50))} | ${fmt(percentile(sortedCpu, 90))} | ${fmt(sortedCpu.at(-1) ?? Number.NaN)} | ${fmt(percentile(sortedWall, 50))} |`,
    );
  }

  const bad = events.filter((e) => e.outcome !== "ok");
  out(
    `\ntail 이벤트 ${events.length}건(요청 ${paths.length * repeats}건), 파싱 실패 ${parseFailures}건, outcome이 ok가 아닌 이벤트 ${bad.length}건. 단위: ms.`,
  );
  for (const e of bad.slice(0, 20)) {
    const url = e.event?.request?.url ? new URL(e.event.request.url) : null;
    out(
      `- ${url ? `${url.pathname}${url.search}` : "?"} status=${e.event?.response?.status ?? "-"} outcome=${e.outcome ?? "-"} cpu=${e.cpuTime ?? "-"} wall=${e.wallTime ?? "-"}`,
    );
  }

  await sleep(60_000); // 계정 분석 집계 대기
  try {
    await accountAnalytics(new Date(started.getTime() - 5_000), new Date(finished.getTime() + 15_000));
  } catch (error) {
    out(`\n계정 분석 오류: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
