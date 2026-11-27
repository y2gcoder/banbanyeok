import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

const [run, mode, ...extra] = process.argv.slice(2);
if (!run || (mode && mode !== "--artifact") || extra.length) {
  throw new Error("사용법: verify.sh report [--artifact]");
}
const artifact = mode === "--artifact";
const evidence = join(run, "evidence");
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const entries = (dir) => readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
const url = (file) => relative(run, file).split(sep).map(encodeURIComponent).join("/");

// Claude Code의 렌더링 한도인 16 MiB 안에 페이지와 증거를 담는다.
let remaining = 12 * 1024 * 1024;
function mediaSource(file, type) {
  if (!artifact) return url(file);
  const encodedSize = 4 * Math.ceil(statSync(file).size / 3);
  if (encodedSize > remaining) return null;
  const encoded = readFileSync(file).toString("base64");
  remaining -= encoded.length;
  return `data:${type};base64,${encoded}`;
}

const cases = existsSync(evidence) ? entries(evidence).filter((entry) => entry.isDirectory()).map(({ name }) => {
  const dir = join(evidence, name);
  const files = entries(dir);
  const resultPath = join(dir, "result.json");
  const result = files.some((entry) => entry.isFile() && entry.name === "result.json")
    ? JSON.parse(readFileSync(resultPath, "utf8"))
    : {};
  return { dir, name, result, files };
}) : [];
const completed = cases.filter(({ result }) => typeof result.ok === "boolean");
const passed = completed.filter(({ result }) => result.ok).length;
const failed = completed.length - passed;
const pending = cases.length - completed.length;

function renderMedia(dir, files, viewport) {
  const shots = files.filter((entry) => entry.isFile() && entry.name.endsWith(".png"));
  const recordings = files.filter((entry) => entry.isDirectory() && /^video-(main|ctx\d+)$/.test(entry.name))
    .flatMap(({ name }) => entries(join(dir, name)).filter((entry) => entry.isFile() && entry.name.endsWith(".webm"))
      .map((entry, index) => ({ file: join(dir, name, entry.name), label: `${name.slice(6)} · ${index + 1}` })));
  let omitted = 0;
  const screenshots = shots.map(({ name }) => {
    const src = mediaSource(join(dir, name), "image/png");
    if (!src) { omitted += 1; return ""; }
    const label = name === "failure.png" ? "실패 시점" : name.slice(0, -4);
    const img = `<img src="${src}" alt="${escape(label)} 화면 캡처" loading="lazy">`;
    return `<figure>${artifact ? img : `<a href="${src}">${img}</a>`}<figcaption>${escape(label)}</figcaption></figure>`;
  }).join("\n");
  const [width, height] = viewport === "phone" ? [390, 844] : [1280, 800];
  const videos = recordings.map(({ file, label }) => {
    const src = mediaSource(file, "video/webm");
    if (!src) { omitted += 1; return ""; }
    return `<figure><video controls playsinline preload="none" loading="lazy" width="${width}" height="${height}" aria-label="${label} 화면 영상" src="${src}"></video>
    <figcaption>${artifact ? label : `<a href="${src}">${label} WebM 원본</a>`}</figcaption></figure>`;
  }).join("\n");
  return `<h3>캡처</h3>${screenshots ? `<div class="gallery">${screenshots}</div>` : "<p>표시할 캡처 없음</p>"}
  <h3>영상</h3>${videos ? `<div class="gallery">${videos}</div>` : "<p>표시할 영상 없음</p>"}
  ${omitted ? `<p>크기 한도로 제외한 미디어 ${omitted}개는 로컬 보고서에서 볼 수 있습니다.</p>` : ""}`;
}

function renderCase({ dir, name, result, files }) {
  const status = result.ok === true ? "통과" : result.ok === false ? "실패" : "결과 없음";
  const viewport = { phone: "폰 390 × 844", desktop: "데스크톱 1280 × 800" }[result.viewport] ?? "화면 정보 없음";
  const details = files.filter((entry) => entry.isFile() && /^(result\.json|trace(?:-ctx\d+)?\.zip|steps\.log|console\.txt|network\.jsonl)$/.test(entry.name))
    .map(({ name: file }) => `<li><a href="${url(join(dir, file))}">${file}</a></li>`).join("");
  return `<article>
  <h2>${escape(result.journey ?? name)}</h2>
  <p class="status ${result.ok === false ? "failed" : ""}">${status} · ${viewport}</p>
  <p>${escape(result.startedAt ?? name)} · 실행 시작 커밋 ${escape(String(result.head ?? "미기록").slice(0, 12))}</p>
  ${renderMedia(dir, files, result.viewport)}
  ${!artifact && details ? `<h3>상세 증거</h3><ul>${details}</ul>` : ""}
  </article>`;
}

const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>반반역 검증 보고서</title>
<style>
  :root{color-scheme:light dark;font:17px/1.55 system-ui}
  body{max-width:72rem;margin:0 auto;padding:clamp(1rem,4vw,3rem);overflow-wrap:anywhere}
  header,article{border-block-start:1px solid GrayText;padding-block:1rem}
  h1,h2,h3,p{margin:.35em 0 .65em}
  .status{font-weight:700}.failed{color:light-dark(#9b241d,#ffaba2)}
  .gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:1.25rem;margin-block:1rem}
  figure{margin:0;min-width:0}img,video{display:block;max-width:100%;height:auto;max-height:38rem;object-fit:contain}
  figcaption{margin-block-start:.4rem}ul{display:flex;flex-wrap:wrap;gap:.3rem 2rem}
</style></head><body><main>
<header><h1>반반역 검증 보고서</h1>
<p>실행 ${escape(basename(run))} · 통과 ${passed} · 실패 ${failed} · 결과 없음 ${pending}</p>
${artifact ? "<p>전체 미디어와 상세 기록은 로컬 보고서에서 볼 수 있습니다.</p>" : ""}
</header>
${cases.length ? cases.map(renderCase).join("\n") : "<p>이 실행의 검증 증거가 없습니다.</p>"}
</main></body></html>
`;
const output = join(run, artifact ? "report-artifact.html" : "report.html");
const pendingOutput = `${output}.${randomUUID()}.tmp`;
writeFileSync(pendingOutput, html, { mode: 0o600 });
renameSync(pendingOutput, output);
console.log(output);
