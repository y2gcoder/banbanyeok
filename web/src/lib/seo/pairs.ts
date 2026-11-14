/**
 * 파이프라인이 사전 계산한 인기 역 조합(`seo-pairs.json`)의 형식·검증. 웹은 순위를 계산하지 않고 이 값을 그대로 보여 준다.
 *
 * 이 모듈과 `pair-pages.ts`·`load.ts`는 next.config.ts(리다이렉트)도 불러서 `@/` 별칭 대신 상대 경로를 쓴다.
 *
 * 형식은 읽는 쪽에 엄격하다(알 수 없는 키 = 오류, contracts/data-format.md §6). 파일이 약속(a<b·중복 없음·파생 값 일치)을
 * 어기면 빌드를 멈춘다. 페이지가 잘못된 숫자를 공개하는 것보다 낫다.
 */
import { z } from "zod";
import { isStationCode } from "../link/codec.ts";

const SEO_PAIRS_SCHEMA_VERSION = 1;
export const MAX_RESULTS_PER_PAIR = 3;
const MAX_SECONDS = 65_534; // od.bin 시간 상한(data-format §4.2)
const MAX_TRANSFERS = 254;

const stationCode = z.string().refine(isStationCode, "역 코드 형식이 아닙니다(소문자·숫자 base32 3자)");
const seconds = z.number().int().min(0).max(MAX_SECONDS);
const transfers = z.number().int().min(0).max(MAX_TRANSFERS);

const resultSchema = z
  .object({
    stationCode,
    times: z.tuple([seconds, seconds]),
    transfers: z.tuple([transfers, transfers]),
    maxSeconds: seconds,
    spreadSeconds: seconds,
    totalSeconds: z.number().int().min(0),
    reason: z.string().min(1),
  })
  .strict()
  .superRefine((result, ctx) => {
    const [a, b] = result.times;
    const derived = { maxSeconds: Math.max(a, b), spreadSeconds: Math.abs(a - b), totalSeconds: a + b };
    for (const key of ["maxSeconds", "spreadSeconds", "totalSeconds"] as const) {
      if (result[key] !== derived[key]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key}가 times에서 계산한 값(${derived[key]})과 다릅니다`,
        });
      }
    }
  });

const pairSchema = z
  .object({
    a: stationCode,
    b: stationCode,
    results: z.array(resultSchema).min(1).max(MAX_RESULTS_PER_PAIR),
  })
  .strict()
  .superRefine((pair, ctx) => {
    if (!(pair.a < pair.b)) {
      ctx.addIssue({ code: "custom", path: ["a"], message: `a<b(코드 사전순)여야 합니다: ${pair.a}, ${pair.b}` });
    }
    const codes = pair.results.map((r) => r.stationCode);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", path: ["results"], message: "한 쌍의 결과에 같은 역이 두 번 있습니다" });
    }
  });

const fileSchema = z
  .object({
    schemaVersion: z.literal(SEO_PAIRS_SCHEMA_VERSION),
    dataVersion: z.string().regex(/^[0-9]{8}\.[0-9]{1,3}$/, "dataVersion은 YYYYMMDD.N 형식입니다"),
    pairs: z.array(pairSchema),
  })
  .strict()
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.pairs.forEach((pair, index) => {
      const key = `${pair.a}|${pair.b}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["pairs", index], message: `중복된 쌍입니다: ${key}` });
      seen.add(key);
    });
  });

export type SeoPair = z.infer<typeof pairSchema>;
export type SeoPairsFile = z.infer<typeof fileSchema>;

/** JSON 텍스트(또는 파싱된 값)를 검증한다. 첫 문제들을 사람이 읽을 수 있게 모아 던진다. */
export function parseSeoPairs(input: unknown): SeoPairsFile {
  const parsed = fileSchema.safeParse(typeof input === "string" ? JSON.parse(input) : input);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  throw new Error(`seo-pairs.json 형식 오류:\n${lines.join("\n")}`);
}

/** `dataVersion`(YYYYMMDD.N)의 날짜. 사이트맵 lastmod와 "데이터 기준" 문구에 쓴다. */
export function dataVersionDate(dataVersion: string): { year: number; month: number; day: number; iso: string } {
  const match = /^([0-9]{4})([0-9]{2})([0-9]{2})\.[0-9]{1,3}$/.exec(dataVersion);
  if (!match) throw new RangeError(`dataVersion 형식이 아닙니다: ${dataVersion}`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
}
