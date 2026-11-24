/**
 * "언제 만나요?" 구분 정의와 공휴일을 웹 번들용으로 옮긴다. 원본은 contracts/time-slots.json(구분·문구·경계)과
 * contracts/holidays.json(관공서 공휴일, 연 1회 갱신)이고 서버도 같은 파일을 쓴다.
 * 출력: src/lib/when/time-slots.gen.ts — 화면이 쓰는 값만(라벨·힌트·경계·기본 구분·운행일 시작·공휴일 날짜→이름·목록 범위).
 * 운행일 시작(`serviceDayStart`, rules의 "03:00 전은 전날 운행일")은 자정을 넘는 시간대(밤)가 끝나는 시각이고 첫 시간대가 시작하는
 * 시각이다. 둘이 다르면 정의가 어긋난 것이라 만들지 않는다.
 * JSON이 아니라 TS로 쓴다: 가짜 서버(mock/, node가 직접 실행)도 같은 모듈을 불러오기 때문이다(JSON import에는 속성이 필요하다).
 *
 * 사용: pnpm gen:time-slots  (CI는 재생성 후 git diff로 커밋본과 비교한다)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
type Slots = {
  default: string;
  dayTypes: { id: string; label: string }[];
  bands: { id: string; label: string; hint: string; from: string; to: string }[];
};
type Holidays = { coverage: { from: string; to: string }; holidays: { date: string; name: string }[] };

const slots = JSON.parse(readFileSync(resolve(root, "contracts/time-slots.json"), "utf8")) as Slots;
const holidays = JSON.parse(readFileSync(resolve(root, "contracts/holidays.json"), "utf8")) as Holidays;

const overnight = slots.bands.filter((b) => b.to <= b.from);
const serviceDayStart = overnight[0]?.to;
if (overnight.length !== 1 || serviceDayStart === undefined || serviceDayStart !== slots.bands[0]?.from) {
  throw new Error(
    `운행일 시작을 정할 수 없다: 자정을 넘는 시간대 ${overnight.length}개, 첫 시간대 시작 ${slots.bands[0]?.from}`,
  );
}

const out = {
  default: slots.default,
  serviceDayStart,
  dayTypes: slots.dayTypes.map(({ id, label }) => ({ id, label })),
  bands: slots.bands.map(({ id, label, hint, from, to }) => ({ id, label, hint, from, to })),
  holidays: Object.fromEntries(holidays.holidays.map(({ date, name }) => [date, name])),
  holidayCoverage: holidays.coverage,
};
const header =
  "// 생성 파일: contracts/time-slots.json·contracts/holidays.json에서 만든다(pnpm gen:time-slots). 직접 고치지 않는다.\n";
const target = resolve(root, "web/src/lib/when/time-slots.gen.ts");
writeFileSync(target, `${header}export const TIME_SLOTS = ${JSON.stringify(out, null, 2)} as const;\n`);
// 커밋본과 같은 모양이 되게 저장소의 포매터로 정리한다(check:contracts가 diff로 비교한다).
execFileSync("pnpm", ["exec", "biome", "format", "--write", target], { stdio: "inherit" });
process.stdout.write(
  `time-slots.gen.ts: 구분 ${out.dayTypes.length * out.bands.length}개, 공휴일 ${holidays.holidays.length}일\n`,
);
