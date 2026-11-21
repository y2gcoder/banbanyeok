/**
 * 오류 코드 표를 웹 번들용으로 옮긴다. 원본은 contracts/problems.json(서버의 `ProblemTypes`도 같은 표를 따르고 서버 테스트가 맞는지 본다).
 * 출력: src/lib/problems/problems.gen.ts — /problems 페이지가 쓰는 값(code·type 주소의 slug·상태·제목·뜻).
 * TS로 쓰는 이유는 build-time-slots.ts와 같다(가짜 서버(mock/)도 같은 모듈을 불러온다).
 *
 * 사용: pnpm gen:problems  (CI는 재생성 후 git diff로 커밋본과 비교한다)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
type Table = { baseUri: string; problems: { code: string; status: number; title: string; meaning: string }[] };

const table = JSON.parse(readFileSync(resolve(root, "contracts/problems.json"), "utf8")) as Table;
const seen = new Set<string>();
for (const { code } of table.problems) {
  if (seen.has(code)) throw new Error(`오류 코드가 겹쳐요: ${code}`);
  seen.add(code);
}

const out = {
  baseUri: table.baseUri,
  items: table.problems.map(({ code, status, title, meaning }) => ({
    code,
    slug: code.toLowerCase().replaceAll("_", "-"),
    status,
    title,
    meaning,
  })),
};
const header = "// 생성 파일: contracts/problems.json에서 만든다(pnpm gen:problems). 직접 고치지 않는다.\n";
const target = resolve(root, "web/src/lib/problems/problems.gen.ts");
writeFileSync(target, `${header}export const PROBLEMS = ${JSON.stringify(out, null, 2)} as const;\n`);
execFileSync("pnpm", ["exec", "biome", "format", "--write", target], { stdio: "inherit" });
process.stdout.write(`problems.gen.ts: 오류 코드 ${out.items.length}개\n`);
