/**
 * 방 API 호출이 계약대로(경로·메서드·헤더) 나가는지. 토큰은 `Authorization` 헤더에만 있고 URL·본문에는 없어야 한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from "@/lib/proxy/headers";
import { ApiRequestError } from "./client";
import {
  answerOutcome,
  createRoom,
  deleteRoom,
  getRoom,
  getRoomPreview,
  getRoomResult,
  joinRoom,
  removeParticipant,
  setDecision,
  updateParticipant,
  updateRoom,
} from "./rooms";

const incoming = vi.hoisted(() => new Headers());
vi.mock("next/headers", () => ({ headers: async () => incoming }));

const ROOM = "qt7yvmsht3";
const SECRET = "tok_SECRET_value_123";

type Sent = { url: URL; method: string; headers: Headers; body: string };
let sent: Sent[] = [];
let respond: () => Response = () => new Response(null, { status: 204 });

beforeEach(() => {
  sent = [];
  respond = () => new Response(null, { status: 204 });
  vi.stubGlobal("fetch", async (input: Request) => {
    sent.push({
      url: new URL(input.url),
      method: input.method,
      headers: input.headers,
      body: await input.clone().text(),
    });
    return respond();
  });
});
afterEach(() => vi.unstubAllGlobals());

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const problemJson = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json; charset=UTF-8" },
  });

describe("방 API 호출", () => {
  it("방 만들기: POST /rooms, Idempotency-Key, 토큰 없음", async () => {
    respond = json(201, { roomId: ROOM, hostToken: "h", participantId: "p", participantToken: "t", expiresAt: "x" });
    await createRoom({ mode: "fair", host: { originCode: "03v", hidden: false } }, "key-1");
    const [call] = sent;
    expect(call?.method).toBe("POST");
    expect(call?.url.pathname).toBe("/v1/rooms");
    expect(call?.headers.get("idempotency-key")).toBe("key-1");
    expect(call?.headers.get("authorization")).toBeNull();
  });

  it("방 조회: 참여자 토큰은 헤더로만, 없으면 헤더 없음", async () => {
    respond = json(200, { roomId: ROOM, participants: [] });
    await getRoom(ROOM, SECRET);
    await getRoom(ROOM, null);
    expect(sent[0]?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(sent[1]?.headers.get("authorization")).toBeNull();
    for (const call of sent) expect(call.url.toString()).not.toContain(SECRET);
  });

  it("서버에서 부르면 방 조회와 미리보기에 신뢰 헤더(비밀·방문자 IP)를 붙이고, 참여자 토큰도 그대로 보낸다", async () => {
    vi.stubEnv("PROXY_SHARED_SECRET", "proxy-secret-value");
    incoming.set("cf-connecting-ip", "203.0.113.7");
    try {
      respond = json(200, { roomId: ROOM, participants: [] });
      await getRoom(ROOM, null);
      await getRoom(ROOM, SECRET);
      await getRoomPreview(ROOM);
    } finally {
      vi.unstubAllEnvs();
      incoming.delete("cf-connecting-ip");
    }
    for (const call of sent) {
      expect(call.headers.get(PROXY_SECRET_HEADER)).toBe("proxy-secret-value");
      expect(call.headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    }
    expect(sent.map((c) => c.headers.get("authorization"))).toEqual([null, `Bearer ${SECRET}`, null]);
  });

  it("참여: POST /rooms/{id}/participants, Idempotency-Key, 본문에 토큰 없음", async () => {
    respond = json(201, { participantId: "p", participantToken: "t" });
    await joinRoom(ROOM, { originCode: "03v", hidden: true, nickname: "민수" }, "key-2");
    const [call] = sent;
    expect(call?.url.pathname).toBe(`/v1/rooms/${ROOM}/participants`);
    expect(call?.headers.get("idempotency-key")).toBe("key-2");
    expect(JSON.parse(call?.body ?? "{}")).toEqual({ originCode: "03v", hidden: true, nickname: "민수" });
  });

  it("수정·삭제·내보내기·방 설정·방 삭제·결과·outcome: 올바른 메서드와 경로, 토큰은 Authorization 헤더에만", async () => {
    respond = json(200, {});
    await updateParticipant(ROOM, "pid", SECRET, { originCode: "03v", hidden: false });
    respond = () => new Response(null, { status: 204 });
    await removeParticipant(ROOM, "pid", SECRET);
    respond = json(200, {});
    await updateRoom(ROOM, SECRET, { locked: true });
    respond = () => new Response(null, { status: 204 });
    await deleteRoom(ROOM, SECRET);
    respond = json(200, {});
    await getRoomResult(ROOM, { mode: "favor", favor: "pid" }, SECRET);
    respond = () => new Response(null, { status: 204 });
    await answerOutcome(ROOM, SECRET, { outcome: "other", stationCode: "03v" });

    expect(sent.map((c) => `${c.method} ${c.url.pathname}${c.url.search}`)).toEqual([
      `PUT /v1/rooms/${ROOM}/participants/pid`,
      `DELETE /v1/rooms/${ROOM}/participants/pid`,
      `PATCH /v1/rooms/${ROOM}`,
      `DELETE /v1/rooms/${ROOM}`,
      `GET /v1/rooms/${ROOM}/result?mode=favor&favor=pid`,
      `POST /v1/rooms/${ROOM}/outcome`,
    ]);
    for (const call of sent) {
      expect(call.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
      expect(call.url.toString()).not.toContain(SECRET);
      expect(call.body).not.toContain(SECRET);
    }
  });

  it("정하기·풀기: PUT /rooms/{id}/decision, 본 번호를 본문에, 토큰은 헤더에만", async () => {
    respond = json(200, { roomId: ROOM, participants: [] });
    await setDecision(ROOM, SECRET, { stationCode: "s1q", seenVersion: 7 });
    await setDecision(ROOM, SECRET, { stationCode: null, seenVersion: 8 });
    expect(sent.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `PUT /v1/rooms/${ROOM}/decision`,
      `PUT /v1/rooms/${ROOM}/decision`,
    ]);
    expect(sent.map((c) => JSON.parse(c.body))).toEqual([
      { stationCode: "s1q", seenVersion: 7 },
      { stationCode: null, seenVersion: 8 },
    ]);
    for (const call of sent) {
      expect(call.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
      expect(call.body).not.toContain(SECRET);
    }
    respond = json(409, { code: "ROOM_CHANGED", detail: "바뀜" });
    await expect(setDecision(ROOM, SECRET, { stationCode: "s1q", seenVersion: 7 })).rejects.toMatchObject({
      status: 409,
      code: "ROOM_CHANGED",
    });
  });

  it("미리보기: GET /rooms/{id}/preview, 토큰을 보내지 않는다", async () => {
    respond = json(200, { stage: "collecting", room: {} });
    await getRoomPreview(ROOM);
    expect(sent.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([`GET /v1/rooms/${ROOM}/preview`]);
    expect(sent[0]?.headers.get("authorization")).toBeNull();
  });

  it("오류는 계약의 {code, detail}로 ApiRequestError가 된다(204 응답은 오류가 아니다)", async () => {
    respond = json(409, { code: "ROOM_FULL", detail: "방이 가득 찼습니다" });
    await expect(joinRoom(ROOM, { originCode: "03v", hidden: false }, "k")).rejects.toMatchObject({
      status: 409,
      code: "ROOM_FULL",
      name: "ApiRequestError",
    });
    respond = json(404, { code: "ROOM_NOT_FOUND", detail: "없음" });
    await expect(removeParticipant(ROOM, "pid", SECRET)).rejects.toBeInstanceOf(ApiRequestError);
    respond = () => new Response(null, { status: 204 });
    await expect(removeParticipant(ROOM, "pid", SECRET)).resolves.toBeUndefined();
  });

  it("application/problem+json 오류도 code와 detail로 ApiRequestError가 된다", async () => {
    respond = problemJson(409, {
      type: "https://banbanyeok.app/problems/room-full",
      title: "방이 가득 참",
      status: 409,
      detail: "방이 가득 찼습니다",
      code: "ROOM_FULL",
    });
    await expect(joinRoom(ROOM, { originCode: "03v", hidden: false }, "k")).rejects.toMatchObject({
      status: 409,
      code: "ROOM_FULL",
      message: "방이 가득 찼습니다",
      name: "ApiRequestError",
    });
  });
});
