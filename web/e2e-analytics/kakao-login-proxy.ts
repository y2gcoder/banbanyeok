import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base } from "@playwright/test";

export const LOGIN_URL = "https://accounts.kakao.com/login?continue=https%3A%2F%2Fsharer.kakao.com%2Fpicker%2Flink";

/**
 * route.fulfill(302) 뒤의 GET은 Playwright route를 다시 거치지 않는다.
 * 브라우저의 실제 HTTPS/302/CSP 경로를 유지하면서 외부 연결을 막는 로컬 CONNECT 프록시.
 * 인증서는 worker마다 임시 생성하고 지운다(제품 인증서·키를 쓰지 않는다).
 */
export const test = base.extend<Record<never, never>, { kakaoProxy: string }>({
  kakaoProxy: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright fixture dependencies must use destructuring.
    async ({}, use) => {
      const directory = mkdtempSync(join(tmpdir(), "kakao-login-"));
      const key = join(directory, "key.pem");
      const cert = join(directory, "cert.pem");
      execFileSync(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=accounts.kakao.com",
        ],
        { stdio: "ignore" },
      );
      const secure = createSecureServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
        if (request.headers.host === "sharer.kakao.com" && request.url === "/picker/link") {
          if (request.method === "POST") {
            request.resume();
            response.writeHead(302, { location: LOGIN_URL });
          } else {
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          }
          response.end();
        } else if (request.headers.host === "accounts.kakao.com" && request.url?.startsWith("/login?")) {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end("<title>카카오계정 fixture</title>");
        } else {
          response.writeHead(502);
          response.end("Unexpected Kakao fixture request");
        }
      });
      const sockets = new Set<import("node:net").Socket>();
      const proxy = createServer((_request, response) => {
        response.writeHead(502);
        response.end("Only fixture HTTPS tunnels are supported");
      });
      proxy.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
      });
      proxy.on("connect", (request, socket, head) => {
        if (!["sharer.kakao.com:443", "accounts.kakao.com:443"].includes(request.url ?? "")) {
          socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          return;
        }
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) socket.unshift(head);
        secure.emit("connection", socket);
      });
      await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
      const address = proxy.address();
      if (!address || typeof address === "string") throw new Error("Kakao proxy did not listen");
      try {
        await use(`http://127.0.0.1:${address.port}`);
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
        rmSync(directory, { recursive: true, force: true });
      }
    },
    { scope: "worker" },
  ],
  proxy: async ({ kakaoProxy }, use) => use({ server: kakaoProxy, bypass: "127.0.0.1,localhost" }),
  ignoreHTTPSErrors: true,
});
