// 화면 시안을 PNG로 찍는다. web 폴더에서 실행한다(Playwright를 web의 의존성에서 찾는다):
//   cd web && node ../spikes/last-train-design/mock/shoot.mjs <출력 폴더>
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(join(process.cwd(), "package.json"));
const { chromium } = require("@playwright/test");

const out = resolve(process.argv[2] ?? "last-train-screens");
mkdirSync(out, { recursive: true });
const page = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "screens.html")).href;

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await tab.goto(page);
await tab.evaluate(() => document.fonts.ready);
for (const shot of await tab.locator(".shot").all()) {
  const id = (await shot.getAttribute("id")).replace(/^s-/, "");
  await shot.screenshot({ path: join(out, `${id}.png`) });
  console.log(`${id}.png`);
}
await browser.close();
