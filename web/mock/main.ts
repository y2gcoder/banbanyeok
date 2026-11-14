/** 가짜 서버 단독 실행: `pnpm mock` (MOCK_PORT, 기본 4010). */
import { createMockServer, listen } from "./server.ts";

const port = await listen(createMockServer(), Number(process.env.MOCK_PORT ?? 4010));
process.stdout.write(`mock API: http://127.0.0.1:${port} (GET /healthz, POST /v1/recommend)\n`);
