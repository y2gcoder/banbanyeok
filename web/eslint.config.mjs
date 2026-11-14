// ESLint는 Biome가 못 하는 **타입 인식 규칙**만 맡는다(포맷·일반 린트는 Biome).
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
      "src/lib/api/schema.gen.ts",
    ],
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "error" },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: false }],
    },
  },
  {
    // 서버 호출은 src/lib/api만 한다(dependency-cruiser가 import를, 이 규칙이 전역 fetch를 막는다).
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/api/**", "src/**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": ["error", { name: "fetch", message: "서버 호출은 src/lib/api를 거친다." }],
    },
  },
);
