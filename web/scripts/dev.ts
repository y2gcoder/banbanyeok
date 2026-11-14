/**
 * `next dev` 실행기. `mise run dev:web`(scripts/dev.sh web)과 `mise run dev:web:mock`이 이 파일을 부른다.
 *
 * - 기본: API_ORIGIN(없으면 SERVER_PORT로 만든 로컬 Ktor 주소)으로 rewrite한다.
 * - NEXT_PUBLIC_API_MOCKING=enabled: 가짜 서버(mock/server.ts)를 빈 포트에 띄우고 API_ORIGIN을 그쪽으로 바꾼다.
 * 나머지 인자(--port 등)는 next dev에 그대로 넘긴다.
 */
import { spawn } from "node:child_process";
import { createMockServer, listen } from "../mock/server.ts";

const env = { ...process.env };
if (env.NEXT_PUBLIC_API_MOCKING === "enabled") {
  const port = await listen(createMockServer(), Number(env.MOCK_PORT ?? 0));
  env.API_ORIGIN = `http://127.0.0.1:${port}`;
  process.stdout.write(`mock API: ${env.API_ORIGIN}\n`);
} else {
  process.stdout.write(`API: ${env.API_ORIGIN ?? `http://localhost:${env.SERVER_PORT ?? "8080"}`}\n`);
}

const child = spawn("next", ["dev", ...process.argv.slice(2)], { stdio: "inherit", env });
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
