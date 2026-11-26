import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 이 빌드의 역 색인이 권역 데이터인가(부산권 공개 뒤, ADR-0008). 화면은 권역이 둘 이상일 때만 권역 고르기를 그린다.
 * 포커스 순서·계산 범위 테스트는 수도권 단독 상태와 부산권 공개 상태를 각각 검증한다.
 */
export const REGIONAL: boolean =
  "regions" in
  (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../src/lib/stations/index.gen.json"), "utf8")) as object);
