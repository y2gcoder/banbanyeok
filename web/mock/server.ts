/**
 * contracts/openapi.yaml 기반 가짜 서버(개발·e2e 전용). 화면이 쓰는 `GET /healthz`, `POST /v1/recommend`를 구현하고
 * 나머지 경로는 계약의 오류 모양 `{code, message}`로 501을 준다. 응답이 계약 스키마를 지키는지는
 * src/lib/api/contract.test.ts가 ajv로 검사한다. 도구 선택 근거는 docs/setup/p4-notes.md.
 *
 * 환경 변수: MOCK_DELAY_MS(모든 응답 지연), MOCK_COLD_START_MS(첫 요청만 지연, 콜드스타트 흉내).
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type MockData, type MockStation, mockRecommend, type RecommendBody } from "./recommend.ts";

const here = dirname(fileURLToPath(import.meta.url));
const STATION_CODE = /^[0-9a-hjkmnp-tv-z]{3}$/;

type IndexFile = {
  dataVersion: string;
  lines: string[];
  stations: [string, string, number[], string[], number, ...number[]][];
};

export function loadMockData(): MockData {
  const index = JSON.parse(readFileSync(resolve(here, "../src/lib/stations/index.gen.json"), "utf8")) as IndexFile;
  const candidateCodes = new Set(
    (
      JSON.parse(readFileSync(resolve(here, "../../data/artifacts/dev/candidates.json"), "utf8")) as {
        candidates: string[];
      }
    ).candidates,
  );
  const origins = new Map<string, MockStation>();
  const candidates: MockStation[] = [];
  for (const [code, name, lineIdx, , supported, lat, lng] of index.stations) {
    if (lat === undefined || lng === undefined) continue;
    const station = { code, name, lines: lineIdx.map((i) => index.lines[i] ?? ""), lat, lng };
    if (supported === 1) origins.set(code, station);
    if (candidateCodes.has(code)) candidates.push(station);
  }
  return { origins, candidates, dataVersion: index.dataVersion };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function error(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { code, message });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** 계약의 요청 스키마 검사(origins 2~4개·역 코드 형식, mode, favorIndex 0~3) + 출발 가능 역 확인. */
export function validateRecommend(data: MockData, input: unknown): RecommendBody | { code: string; message: string } {
  if (typeof input !== "object" || input === null)
    return { code: "BAD_REQUEST", message: "본문이 JSON 객체가 아니에요." };
  const { origins, mode, favorIndex } = input as Record<string, unknown>;
  if (!Array.isArray(origins) || origins.length < 2 || origins.length > 4) {
    return { code: "BAD_ORIGIN_COUNT", message: "출발역은 2~4개여야 해요." };
  }
  if (!origins.every((o): o is string => typeof o === "string" && STATION_CODE.test(o))) {
    return { code: "BAD_STATION_CODE", message: "역 코드 형식이 올바르지 않아요." };
  }
  if (mode !== "fair" && mode !== "fast" && mode !== "favor")
    return { code: "BAD_MODE", message: "모드가 올바르지 않아요." };
  if (
    favorIndex !== undefined &&
    (typeof favorIndex !== "number" || !Number.isInteger(favorIndex) || favorIndex < 0 || favorIndex > 3)
  ) {
    return { code: "BAD_FAVOR_INDEX", message: "배려 대상 위치가 올바르지 않아요." };
  }
  if (mode === "favor" && (favorIndex === undefined || favorIndex >= origins.length)) {
    return { code: "BAD_FAVOR_INDEX", message: "배려 대상 위치가 올바르지 않아요." };
  }
  const unknown = origins.find((o) => !data.origins.has(o));
  if (unknown) return { code: "UNSUPPORTED_ORIGIN", message: "아직 수도권 지하철역만 계산할 수 있어요." };
  return favorIndex === undefined ? { origins, mode } : { origins, mode, favorIndex };
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export function createMockServer(data: MockData = loadMockData()): Server {
  const delay = Number(process.env.MOCK_DELAY_MS ?? 0);
  let coldStart = Number(process.env.MOCK_COLD_START_MS ?? 0);
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const handle = async () => {
      const wait = delay + coldStart;
      coldStart = 0;
      if (wait > 0) await sleep(wait);
      if (req.method === "GET" && url.pathname === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/recommend") {
        let body: unknown;
        try {
          body = await readJson(req);
        } catch {
          error(res, 400, "BAD_REQUEST", "본문이 JSON이 아니에요.");
          return;
        }
        const checked = validateRecommend(data, body);
        if ("code" in checked) error(res, 400, checked.code, checked.message);
        else send(res, 200, mockRecommend(data, checked));
        return;
      }
      if (url.pathname.startsWith("/v1/")) {
        error(res, 501, "NOT_IMPLEMENTED", "가짜 서버는 이 경로를 구현하지 않았어요.");
        return;
      }
      error(res, 404, "NOT_FOUND", "없는 경로예요.");
    };
    handle().catch((cause: unknown) => {
      console.error(cause);
      error(res, 500, "INTERNAL", "가짜 서버 오류");
    });
  });
}

/** 포트 0이면 빈 포트를 받는다. 실제 포트를 돌려준다. */
export function listen(server: Server, port: number, host = "127.0.0.1"): Promise<number> {
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => done((server.address() as AddressInfo).port));
  });
}
