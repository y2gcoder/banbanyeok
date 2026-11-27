#!/usr/bin/env node
// verify.sh drive가 부른다. 여정 하나를 실제 브라우저로 돌리고 단계마다 증거를 남긴다. 사용법은 ../SKILL.md의 Drive.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const run = process.env.BBY_VERIFY_RUN;
const repo = process.env.BBY_REPO;
const skill = process.env.BBY_SKILL;
if (!run || !repo || !skill) throw new Error("verify.sh drive로 실행한다");

const [journeyArg, viewportArg = "phone"] = process.argv.slice(2);
const state = Object.fromEntries(
  readFileSync(join(run, "state.env"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1).replace(/^'(.*)'$/, "$1")];
    }),
);
if (state.STOPPED_AT) throw new Error(`이미 정리한 실행이다: ${run}`);
const baseURL = `http://localhost:${state.WEB_PORT}`;

const require = createRequire(join(repo, "web/package.json"));
const { chromium, devices, expect } = require("@playwright/test");

const VIEWPORTS = {
  phone: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, screen: { width: 390, height: 844 } },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
};
const device = VIEWPORTS[viewportArg];
if (!device) throw new Error(`화면은 ${Object.keys(VIEWPORTS).join("|")} 중 하나`);

const journeyPath = journeyArg?.endsWith(".mjs") ? resolve(repo, journeyArg) : join(skill, "journeys", `${journeyArg}.mjs`);
if (!existsSync(journeyPath)) throw new Error(`여정 파일이 없다: ${journeyPath}`);
const journeyName = journeyPath.split("/").pop().replace(/\.mjs$/, "");

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const out = mkdtempSync(join(run, "evidence", `${journeyName}-${viewportArg}-${stamp}-`));
const log = (file, line) => appendFileSync(join(out, file), `${line}\n`);

let browser;
let page;
const contexts = [];
async function newContext() {
  const label = contexts.length === 0 ? "main" : `ctx${contexts.length}`;
  const context = await browser.newContext({
    ...device,
    baseURL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    permissions: ["clipboard-read", "clipboard-write"],
    recordVideo: { dir: join(out, `video-${label}`), size: device.viewport },
  });
  contexts.push(context);
  await context.tracing.start({ screenshots: true, snapshots: true, title: `${journeyName} ${label}` });
  context.on("response", (res) => {
    const url = new URL(res.url());
    if (url.origin === baseURL && url.pathname.startsWith("/api/")) {
      log("network.jsonl", JSON.stringify({ ctx: label, method: res.request().method(), path: url.pathname + url.search, status: res.status() }));
    }
  });
  context.on("page", (page) => {
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") log("console.txt", `[${label}] ${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => log("console.txt", `[${label}] pageerror: ${e.message}`));
  });
  return context;
}

let stepNo = 0;

async function capture(name, target = page) {
  stepNo += 1;
  const base = `${String(stepNo).padStart(2, "0")}-${name}`;
  await target.screenshot({ path: join(out, `${base}.png`), fullPage: true });
  writeFileSync(join(out, `${base}.aria.yml`), await target.locator("body").ariaSnapshot());
  log("steps.log", `${base}\t${target.url()}`);
}

const helpers = {
  expect,
  baseURL,
  out,
  viewport: viewportArg,
  /** 사용자 행동 하나를 하고, 그 뒤 상태를 스크린샷·접근성 트리로 남긴다. 다른 사람 화면이면 { page }를 넘긴다. */
  async step(name, action, { page: target = page } = {}) {
    await action?.();
    await capture(name, target);
  },
  /** 다른 사람(저장소·쿠키가 분리된 새 컨텍스트)의 화면. */
  async newPerson() {
    return (await newContext()).newPage();
  },
  /** 이 실행의 DB에 읽기 쿼리를 보내고 결과를 db-<name>.tsv로 남긴다. */
  db(name, sql) {
    const rows = execFileSync("bash", [join(skill, "scripts/verify.sh"), "db", sql], {
      env: { ...process.env, BBY_VERIFY_RUN: run },
      encoding: "utf8",
    });
    writeFileSync(join(out, `db-${name}.tsv`), `-- ${sql}\n${rows}`);
    return rows
      .trim()
      .split("\n")
      .slice(1)
      .map((r) => r.split("\t"));
  },
  /** 증거로 남길 메모(API 응답, 복사한 링크 등). */
  note(name, value) {
    writeFileSync(join(out, `${name}.txt`), typeof value === "string" ? value : JSON.stringify(value, null, 2));
  },
};

let result = { journey: journeyName, viewport: viewportArg, baseURL, runId: state.RUN_ID, head: state.REPO_HEAD, startedAt: now.toISOString() };
try {
  browser = await chromium.launch();
  const context = await newContext();
  page = await context.newPage();
  const journey = (await import(pathToFileURL(journeyPath).href)).default;
  await journey({ ...helpers, page, context });
  result = { ...result, ok: true };
} catch (error) {
  result = { ...result, ok: false, error: String(error?.stack ?? error) };
  await page?.screenshot({ path: join(out, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  for (const [i, ctx] of contexts.entries()) {
    await ctx.tracing.stop({ path: join(out, i === 0 ? "trace.zip" : `trace-ctx${i}.zip`) }).catch(() => {});
    await ctx.close().catch(() => {});
  }
  await browser?.close().catch(() => {});
  writeFileSync(join(out, "result.json.tmp"), `${JSON.stringify(result, null, 2)}\n`);
  renameSync(join(out, "result.json.tmp"), join(out, "result.json"));
}
console.log(`${result.ok ? "PASS" : "FAIL"} ${journeyName} (${viewportArg})`);
console.log(`evidence: ${out}`);
if (!result.ok) {
  console.log(result.error);
  process.exit(1);
}
