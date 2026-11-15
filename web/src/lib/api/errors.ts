import { ApiRequestError } from "./client";

export const CONNECTION_MESSAGE = "서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.";

/**
 * 결과를 받지 못했을 때 사용자에게 보여 줄 짧은 문구. 서버 message·code·HTTP 상태는 보이지 않는다
 * (서버가 아닌 곳(프록시·CDN)이 준 빈 본문·HTML 오류도 같은 문구가 되도록 상태와 code만 본다).
 */
export function resultErrorMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError)) return CONNECTION_MESSAGE;
  if (error.status === 429 || error.code === "RATE_LIMITED") return "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요.";
  if (error.code === "INVALID_STATION" || error.code === "STATION_UNAVAILABLE") {
    return "계산할 수 없는 출발역이 있어요. 출발역을 바꿔서 다시 찾아 주세요.";
  }
  if (error.status >= 400 && error.status < 500) {
    return "이 기준으로는 결과를 받지 못했어요. 다른 기준을 고르거나 잠시 뒤에 다시 시도해 주세요.";
  }
  return CONNECTION_MESSAGE;
}
