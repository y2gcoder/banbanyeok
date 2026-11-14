/**
 * contracts/events.json → src/lib/analytics/events.gen.ts. `pnpm gen:events` (pnpm gen에 포함, check:contracts가 최신인지 확인).
 * 생성 뒤 Biome로 서식을 맞춘다(생성 파일도 린트 예외를 두지 않는다).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildEventsModule, type EventsDocument } from "./analytics-events.ts";

const source = new URL("../../contracts/events.json", import.meta.url);
const target = new URL("../src/lib/analytics/events.gen.ts", import.meta.url);

const doc = JSON.parse(readFileSync(source, "utf8")) as EventsDocument;
writeFileSync(target, buildEventsModule(doc));
execFileSync("pnpm", ["exec", "biome", "format", "--write", fileURLToPath(target)], { stdio: "inherit" });
process.stdout.write(`events.gen.ts: ${doc.events.length} events (schemaVersion ${doc.schemaVersion})\n`);
