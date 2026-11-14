import { describe, expect, it } from "vitest";
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER, upstreamHeaders, withTrustHeaders } from "./headers";
import { proxyApiRequest, upstreamPath } from "./proxy";

const ORIGIN = "https://api.example.test";

function capture() {
  const seen: Request[] = [];
  const fetchImpl = async (request: Request) => {
    seen.push(request);
    return new Response("ok", { status: 200, headers: { "x-from": "server", "set-cookie": "a=b" } });
  };
  return { seen, fetchImpl };
}

describe("upstreamPath", () => {
  it("healthz와 v1 아래만 서버 경로로 바꾼다", () => {
    expect(upstreamPath("/api/healthz")).toBe("/healthz");
    expect(upstreamPath("/api/v1/recommend")).toBe("/v1/recommend");
    expect(upstreamPath("/api/v1/rooms/abc/result")).toBe("/v1/rooms/abc/result");
  });
  it("그 밖의 경로와 상위 경로 우회는 null", () => {
    expect(upstreamPath("/")).toBeNull();
    expect(upstreamPath("/api")).toBeNull();
    expect(upstreamPath("/api/other")).toBeNull();
    expect(upstreamPath("/api/healthz/extra")).toBeNull();
    expect(upstreamPath("/api/v1x/recommend")).toBeNull();
    expect(upstreamPath("/api/v1/../admin")).toBeNull();
  });
});

describe("upstreamHeaders", () => {
  it("브라우저가 보낸 신뢰 헤더를 지우고 우리 값으로 다시 쓴다", () => {
    const incoming = new Headers({
      [PROXY_SECRET_HEADER]: "forged",
      [CLIENT_IP_HEADER]: "6.6.6.6",
      "X-Banbanyeok-Other": "x",
      "content-type": "application/json",
      authorization: "Bearer t",
    });
    const out = upstreamHeaders(incoming, { secret: "s3cret", clientIp: "1.2.3.4" });
    expect(out.get(PROXY_SECRET_HEADER)).toBe("s3cret");
    expect(out.get(CLIENT_IP_HEADER)).toBe("1.2.3.4");
    expect(out.get("x-banbanyeok-other")).toBeNull();
    expect(out.get("content-type")).toBe("application/json");
    expect(out.get("authorization")).toBe("Bearer t");
  });
  it("비밀이 없으면 위조 헤더만 지우고 아무것도 쓰지 않는다", () => {
    const out = upstreamHeaders(new Headers({ [CLIENT_IP_HEADER]: "6.6.6.6" }), {
      secret: undefined,
      clientIp: "1.2.3.4",
    });
    expect(out.get(PROXY_SECRET_HEADER)).toBeNull();
    expect(out.get(CLIENT_IP_HEADER)).toBeNull();
  });
  it("IP를 모르면 비밀도 보내지 않는다", () => {
    const out = upstreamHeaders(new Headers(), { secret: "s3cret", clientIp: null });
    expect(out.get(PROXY_SECRET_HEADER)).toBeNull();
  });
  it("쿠키·호스트·전달 체인·Cloudflare 내부 헤더는 서버로 넘기지 않는다", () => {
    const out = upstreamHeaders(
      new Headers({
        cookie: "a=b",
        host: "web.example",
        "x-forwarded-for": "9.9.9.9",
        "x-real-ip": "9.9.9.9",
        "cf-ray": "abc",
        "cf-connecting-ip": "1.2.3.4",
        accept: "application/json",
      }),
      { secret: "s", clientIp: "1.2.3.4" },
    );
    for (const name of ["cookie", "host", "x-forwarded-for", "x-real-ip", "cf-ray", "cf-connecting-ip"]) {
      expect(out.get(name)).toBeNull();
    }
    expect(out.get("accept")).toBe("application/json");
  });
});

describe("withTrustHeaders", () => {
  it("이미 있는 같은 이름 헤더를 덮어쓴다", () => {
    const headers = new Headers({ [PROXY_SECRET_HEADER]: "old" });
    withTrustHeaders(headers, { secret: "new", clientIp: "1.1.1.1" });
    expect(headers.get(PROXY_SECRET_HEADER)).toBe("new");
    expect(headers.get(CLIENT_IP_HEADER)).toBe("1.1.1.1");
  });
});

describe("proxyApiRequest", () => {
  it("/api 밖의 요청은 처리하지 않는다(null)", async () => {
    const { fetchImpl } = capture();
    expect(
      await proxyApiRequest(new Request("https://web.test/meet"), { origin: ORIGIN, secret: "s", fetchImpl }),
    ).toBeNull();
  });

  it("경로·쿼리·본문을 서버로 넘기고 신뢰 헤더를 붙인다", async () => {
    const { seen, fetchImpl } = capture();
    const request = new Request("https://web.test/api/v1/recommend?x=1", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [PROXY_SECRET_HEADER]: "forged",
        "cf-connecting-ip": "203.0.113.7",
      },
      body: JSON.stringify({ a: 1 }),
    });
    const response = await proxyApiRequest(request, { origin: `${ORIGIN}/`, secret: "s3cret", fetchImpl });
    expect(response?.status).toBe(200);
    const sent = seen[0];
    expect(sent?.url).toBe(`${ORIGIN}/v1/recommend?x=1`);
    expect(sent?.method).toBe("POST");
    expect(await sent?.text()).toBe('{"a":1}');
    expect(sent?.headers.get(PROXY_SECRET_HEADER)).toBe("s3cret");
    expect(sent?.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
  });

  it("healthz GET은 /healthz로 간다", async () => {
    const { seen, fetchImpl } = capture();
    await proxyApiRequest(new Request("https://web.test/api/healthz"), {
      origin: ORIGIN,
      secret: undefined,
      fetchImpl,
    });
    expect(seen[0]?.url).toBe(`${ORIGIN}/healthz`);
  });

  it("서버 응답의 set-cookie는 걸러 내고 나머지는 그대로 돌려준다", async () => {
    const { fetchImpl } = capture();
    const response = await proxyApiRequest(new Request("https://web.test/api/healthz"), {
      origin: ORIGIN,
      secret: "s",
      fetchImpl,
    });
    expect(response?.headers.get("set-cookie")).toBeNull();
    expect(response?.headers.get("x-from")).toBe("server");
    expect(await response?.text()).toBe("ok");
  });

  it("서버 주소가 없으면 503 JSON 오류", async () => {
    const response = await proxyApiRequest(new Request("https://web.test/api/healthz"), {
      origin: "",
      secret: "s",
      fetchImpl: capture().fetchImpl,
    });
    expect(response?.status).toBe(503);
    expect(await response?.json()).toMatchObject({ code: "UPSTREAM_NOT_CONFIGURED" });
  });

  it("연결 실패는 502, 시간 초과는 504(계약의 오류 형식)", async () => {
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    const slow = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    const request = () => new Request("https://web.test/api/v1/recommend", { method: "POST", body: "{}" });
    const unavailable = await proxyApiRequest(request(), { origin: ORIGIN, secret: "s", fetchImpl: down });
    expect(unavailable?.status).toBe(502);
    expect(await unavailable?.json()).toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const timeout = await proxyApiRequest(request(), { origin: ORIGIN, secret: "s", fetchImpl: slow });
    expect(timeout?.status).toBe(504);
    expect(await timeout?.json()).toMatchObject({ code: "UPSTREAM_TIMEOUT" });
  });

  it("서버가 리다이렉트해도 따라가지 않는다", async () => {
    const { seen, fetchImpl } = capture();
    await proxyApiRequest(new Request("https://web.test/api/healthz"), { origin: ORIGIN, secret: "s", fetchImpl });
    expect(seen[0]?.redirect).toBe("manual");
  });
});
