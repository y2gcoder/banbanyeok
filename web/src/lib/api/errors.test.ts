import { describe, expect, it } from "vitest";
import { ApiRequestError, failure } from "./client";
import { resultErrorMessage } from "./errors";

describe("failure", () => {
  const problem = {
    type: "https://banbanyeok.app/problems/invalid-mode",
    title: "모드가 올바르지 않음",
    status: 400,
    detail: "모드가 올바르지 않아요",
    code: "INVALID_MODE",
    message: "호환용 문구",
  };

  it("application/problem+json 본문은 code로 분기하고 문구는 detail을 쓴다", () => {
    const error = failure(400, problem);
    expect(error).toMatchObject({ status: 400, code: "INVALID_MODE", message: "모드가 올바르지 않아요" });
  });

  it("옛 application/json {code, message} 본문(옛 서버)도 그대로 담는다", () => {
    const error = failure(400, { code: "INVALID_MODE", message: "모드가 올바르지 않아요" });
    expect(error).toMatchObject({ status: 400, code: "INVALID_MODE", message: "모드가 올바르지 않아요" });
  });

  it("detail이 없으면 message를 쓴다", () => {
    const { detail: _detail, ...withoutDetail } = problem;
    expect(failure(400, withoutDetail as never).message).toBe("호환용 문구");
  });

  it("detail도 message도 없으면 문구는 빈 문자열이고 code는 남는다", () => {
    expect(failure(409, { code: "ROOM_FULL" } as never)).toMatchObject({ code: "ROOM_FULL", message: "" });
  });

  it("형식 없는 500(빈 본문·HTML·평문)은 code UNKNOWN과 HTTP 상태 문구다", () => {
    for (const body of ["", "Internal Server Error", "<html>500</html>"]) {
      expect(failure(500, body)).toMatchObject({ status: 500, code: "UNKNOWN", message: "HTTP 500" });
    }
  });

  it("본문이 비었거나 JSON이 아니어도(HTML 403 등) code는 UNKNOWN이고 message는 문자열이다", () => {
    // openapi-fetch는 JSON이 아닌 오류 본문을 문자열로 돌려준다(빈 본문은 "").
    for (const body of ["", "<html>Forbidden</html>", undefined] as const) {
      const error = failure(403, body as never);
      expect(error.code).toBe("UNKNOWN");
      expect(typeof error.message).toBe("string");
      expect(error.message).not.toBe("");
    }
  });
});

describe("resultErrorMessage", () => {
  const api = (status: number, code = "UNKNOWN", message = "내부 문구") => new ApiRequestError(status, code, message);

  it("서버 message·code·HTTP 상태를 그대로 보이지 않는다", () => {
    for (const error of [api(403), api(400, "FAVOR_TARGET_REQUIRED"), api(500), api(404, "X", "SECRET_BODY")]) {
      const text = resultErrorMessage(error);
      expect(text).not.toMatch(/내부 문구|SECRET_BODY|FAVOR_TARGET|HTTP|\b[45]\d\d\b/);
      expect(text.length).toBeGreaterThan(8);
    }
  });

  it("요청이 몰린 경우(429)·계산할 수 없는 역·그 밖의 4xx·연결 실패를 구분한다", () => {
    expect(resultErrorMessage(api(429, "RATE_LIMITED"))).toMatch(/너무 많아요/);
    expect(resultErrorMessage(api(400, "INVALID_STATION"))).toMatch(/출발역/);
    expect(resultErrorMessage(api(403))).toMatch(/기준|다시/);
    expect(resultErrorMessage(api(502, "UPSTREAM_UNAVAILABLE"))).toMatch(/연결하지 못했어요/);
    expect(resultErrorMessage(new TypeError("Failed to fetch"))).toMatch(/연결하지 못했어요/);
  });
});
