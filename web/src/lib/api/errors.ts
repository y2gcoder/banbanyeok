import { ApiRequestError } from "./client";

export const CONNECTION_MESSAGE = "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";

/**
 * 권역이 섞였다(400 `REGION_MISMATCH`). 웹이 섞인 두 권역을 알면(보이는 출발역과 고른 역의 권역) 그 이름을 짚고, 모르면 공통 문구다.
 * 오류 응답에는 역·권역이 없어서(계약) 이름은 화면이 넘긴다.
 */
export function regionMismatchMessage(regionNames: readonly string[]): string {
  const [a, b] = regionNames;
  if (regionNames.length === 2 && a && b)
    return `${a} 역과 ${b} 역은 함께 계산하지 않아요. 같은 권역의 역으로 골라 주세요.`;
  return "한 번에 한 권역 안에서만 계산해요. 같은 권역의 역으로 골라 주세요.";
}

/**
 * 409 `SCHEDULE_UNAVAILABLE`. 출발역 하나가 그 구분에 출발할 수 없을 때, 권역의 구분 전체를 계산하지 못할 때, 부산권의 그 구분 행렬이
 * 없을 때 모두 같은 응답이라 원인을 단정하지 않고 세 경우에 다 맞는 행동만 말한다.
 */
export const SCHEDULE_UNAVAILABLE_MESSAGE =
  "이 요일·시간대의 시간표를 아직 확인하지 못해 계산하지 못했어요. 다른 요일이나 시간대로 바꿔 보세요.";

/**
 * 결과를 받지 못했을 때 사용자에게 보여 줄 짧은 문구. 서버 message·code·HTTP 상태는 보이지 않는다
 * (서버가 아닌 곳(프록시·CDN)이 준 빈 본문·HTML 오류도 같은 문구가 되도록 상태와 code만 본다).
 * `regionNames`는 권역이 섞였을 때 짚을 권역 이름이다(regionMismatchMessage).
 */
export function resultErrorMessage(error: unknown, regionNames: readonly string[] = []): string {
  if (!(error instanceof ApiRequestError)) return CONNECTION_MESSAGE;
  if (error.status === 429 || error.code === "RATE_LIMITED") return "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.";
  if (error.code === "REGION_MISMATCH") return regionMismatchMessage(regionNames);
  if (error.code === "SCHEDULE_UNAVAILABLE") return SCHEDULE_UNAVAILABLE_MESSAGE;
  if (error.code === "INVALID_STATION" || error.code === "STATION_UNAVAILABLE") {
    return "계산할 수 없는 출발역이 있어요. 출발역을 바꿔서 다시 찾아 주세요.";
  }
  if (error.status >= 400 && error.status < 500) {
    return "이 기준으로는 결과를 받지 못했어요. 다른 기준을 고르거나 잠시 뒤에 다시 시도해 주세요.";
  }
  return CONNECTION_MESSAGE;
}
