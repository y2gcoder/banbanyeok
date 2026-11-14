/** 생성된 계약 타입(schema.gen.ts)에서 화면이 쓰는 이름만 꺼낸다. */
import type { components, paths } from "./schema.gen";

type Schemas = components["schemas"];

export type Mode = Schemas["Mode"];
export type RecommendResult = Schemas["Result"];
export type RecommendBody = paths["/recommend"]["post"]["requestBody"]["content"]["application/json"];
export type ApiError = Schemas["Error"];
