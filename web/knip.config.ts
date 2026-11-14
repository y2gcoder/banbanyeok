import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: ["scripts/*.ts", "e2e/**/*.ts"],
  project: ["src/**/*.{ts,tsx,css}", "mock/**/*.ts", "scripts/**/*.ts", "e2e/**/*.ts"],
  ignore: ["src/lib/api/schema.gen.ts"],
  compilers: {
    // CSS의 @import(tailwindcss, tw-animate-css, pretendard)를 의존성 사용으로 센다.
    css: (text: string) => [...text.matchAll(/(?<=@)import[^;]+/g)].join("\n"),
  },
};

export default config;
