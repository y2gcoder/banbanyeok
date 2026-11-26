import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RoomPreview } from "@/lib/api/types";
import { missingGlyphs, ogSafeName } from "@/lib/copy/og-coverage";
import { OG_HEIGHT, OG_TEXT, OG_WIDTH } from "@/lib/copy/og-text";
import { toResultView } from "@/lib/result/view-model";
import { ROOM_PREVIEW_LAST_TRAIN, roomShareCopy } from "@/lib/room/share-copy";
import { ogFonts } from "@/lib/seo/og-font";
import { buildPairPages } from "@/lib/seo/pair-pages";
import { parseSeoPairs } from "@/lib/seo/pairs";
import { scoreboardCardData } from "@/lib/share-card/scoreboard-card-data";
import { sharedCardData, sharedPreview } from "@/lib/share-card/shared-preview";
import { stationByCode } from "@/lib/stations";
import fixture from "../../../fixtures/seo-pairs.json";
import { PairCard } from "./pair-card";
import { ROOM_CASES, ROOM_DRAW_TEASER } from "./room-card.cases";
import { ScoreboardCard } from "./scoreboard-card";
import { SharedCard } from "./shared-card";
import { HIDDEN_ORIGIN, SHARED_CASES } from "./shared-card.cases";
import { SiteCard } from "./site-card";

/** 있으면 공유 링크 그림을 이 폴더에 PNG로 남긴다(PR 화면 캡처용: OG_SCREENS_DIR=../docs/setup/v1-screens pnpm exec vitest run og-render). */
const screensDir = process.env.OG_SCREENS_DIR;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

async function render(element: React.ReactElement) {
  const response = new ImageResponse(element, { width: OG_WIDTH, height: OG_HEIGHT, fonts: await ogFonts() });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes, view: new DataView(bytes.buffer) };
}

function expectPng({ response, bytes, view }: Awaited<ReturnType<typeof render>>) {
  expect(response.headers.get("content-type")).toBe("image/png");
  expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  expect(view.getUint32(16)).toBe(OG_WIDTH); // IHDR 너비
  expect(view.getUint32(20)).toBe(OG_HEIGHT);
  expect(bytes.length).toBeGreaterThan(5_000);
}

describe("OG 이미지 그리기(satori)", () => {
  const { pages } = buildPairPages(parseSeoPairs(fixture));

  it("조합 페이지 이미지는 1200×630 PNG", async () => {
    for (const page of pages) {
      const drawn = await render(<PairCard page={page} />);
      expectPng(drawn);
      if (screensDir) writeFileSync(join(screensDir, `og-pair-${page.slug}.png`), drawn.bytes);
    }
  });

  it("사이트 기본 이미지", async () => {
    const drawn = await render(<SiteCard />);
    expectPng(drawn);
    if (screensDir) writeFileSync(join(screensDir, "og-site.png"), drawn.bytes);
  });

  it("공유 링크 이미지: 정해 둔 경우 전부(2·3·4명, 긴 별칭, 숨김, 같은 역, 0분, 빠른·누구 쪽으로, 기준 문구, 긴 역 이름, 1시간 넘음)", async () => {
    for (const c of SHARED_CASES) {
      const view = toResultView(c.result);
      const data = sharedCardData(view, c.state);
      if (!data) throw new Error(`${c.id}: 그림 데이터 없음`);
      // 숨긴 출발역은 그림 값·미리보기 설명 어디에도 없다(입력에 본인 시점의 출발역 이름이 들어 있어도: hidden-self-view).
      expect(JSON.stringify([data, sharedPreview(view, c.state)])).not.toContain(HIDDEN_ORIGIN);
      expect(missingGlyphs(data.people.map((p) => p.lastTrain ?? "").join("")), c.id).toEqual([]);
      const drawn = await render(<SharedCard data={data} />);
      expectPng(drawn);
      if (screensDir) writeFileSync(join(screensDir, `og-${c.id}.png`), drawn.bytes);
    }
  });

  it("공유 링크 이미지 A 숫자판(/s/og): 정해 둔 경우 전부, 글꼴에 없는 글자 없음, 숨긴 출발역 없음", async () => {
    for (const c of SHARED_CASES) {
      const view = toResultView(c.result);
      const data = scoreboardCardData(view, c.state);
      if (!data) throw new Error(`${c.id}: 그림 데이터 없음`);
      const text = [
        data.stationName,
        data.suffix ?? "",
        data.modeLine,
        data.compareLine ?? "",
        data.basisLine ?? "",
        data.title ?? "",
        ...data.people.map((p) => p.name),
        ...data.people.map((p) => p.lastTrain ?? ""),
      ].join("");
      expect(missingGlyphs(text), c.id).toEqual([]);
      expect(JSON.stringify(data), c.id).not.toContain(HIDDEN_ORIGIN);
      const drawn = await render(<ScoreboardCard data={data} />);
      expectPng(drawn);
      if (screensDir) writeFileSync(join(screensDir, `og-scoreboard-${c.id}.png`), drawn.bytes);
    }
  });

  it("호선 배지 표본: 1노선·4노선·긴 이름·4명과 긴 비교 문장", async () => {
    const sample = SHARED_CASES.find((c) => c.id === "four-last-train-middle");
    if (!sample) throw new Error("표본 없음");
    const base = scoreboardCardData(toResultView(sample.result), sample.state);
    if (!base) throw new Error("그림 데이터 없음");
    for (const code of ["9k5", "ct5", "s1q"]) {
      const station = stationByCode(code);
      if (!station) throw new Error(`역 없음: ${code}`);
      const data = {
        ...base,
        stationCode: code,
        stationName: station.name,
        compareLine: "지도 한가운데인 동대문역사문화공원역이면 가장 오래 걸리는 사람은 14분 더 걸려요",
      };
      for (const [kind, element] of [
        ["scoreboard", <ScoreboardCard key="scoreboard" data={data} />],
        ["room", <SharedCard key="room" data={data} />],
      ] as const) {
        const drawn = await render(element);
        expectPng(drawn);
        if (screensDir) writeFileSync(join(screensDir, `og-badges-${kind}-${code}.png`), drawn.bytes);
      }
    }
  });

  it("숨긴 사람 본인 시점처럼 입력에 숨긴 출발역 이름이 있어도 그림 값·미리보기 설명에는 '참가자 N'만 나온다", () => {
    const c = SHARED_CASES.find((x) => x.id === "hidden-self-view");
    if (!c) throw new Error("표본 없음");
    expect(JSON.stringify(c.result)).toContain(HIDDEN_ORIGIN); // 입력에는 있다(본인에게만 오는 originName)
    const hiddenCode = c.result.participants.find((p) => p.hidden)?.originCode;
    expect(hiddenCode).toBeTruthy(); // 본인에게만 오는 실제 숨긴 출발역 코드
    const view = toResultView(c.result);
    const data = sharedCardData(view, c.state);
    const preview = sharedPreview(view, c.state);
    expect(data?.people.map((p) => p.name)).toEqual(["강남", "참가자 2", "홍대입구"]);
    expect(data?.modeLine).toBe("참가자 2 쪽으로 고름");
    expect(preview?.description).toBe("강남 5분 · 참가자 2 4분 · 홍대입구 35분 · 참가자 2 쪽으로 고름");
    expect(JSON.stringify([data, preview])).not.toContain(HIDDEN_ORIGIN);
    expect(JSON.stringify([data, scoreboardCardData(view, c.state)])).not.toContain(JSON.stringify(hiddenCode));
  });

  it('막차 줄: 직행 확정은 분 그대로, 여유 시각은 10분 단위로 내리고, 자정을 넘기면 "다음 날"을 붙이고, 확인 필요와 숨긴 사람은 줄이 없다', () => {
    const lines = (id: string) => {
      const c = SHARED_CASES.find((x) => x.id === id);
      if (!c) throw new Error(`표본 없음: ${id}`);
      return scoreboardCardData(toResultView(c.result), c.state)?.people.map((p) => p.lastTrain ?? null);
    };
    expect(lines("two-last-train")).toEqual(["막차 다음 날 00:03", "늦어도 23:00"]);
    // 직행 확정 24:38, 갈아타는 23:51 → 23:50, 열차 한 대 여유 23:45 → 23:40, 확인 필요.
    expect(lines("four-last-train-middle")).toEqual(["막차 다음 날 00:38", "늦어도 23:50", "늦어도 23:40", null]);
    // 숨긴 사람의 항목은 서버가 주지 않는다.
    expect(lines("nickname-hidden")).toEqual(["늦어도 23:20", null, "막차 다음 날 00:34"]);
    // 숨긴 본인에게는 서버가 본인의 막차도 주지만, 누구나 보는 그림에는 넣지 않는다.
    const self = SHARED_CASES.find((x) => x.id === "hidden-self-view");
    expect(JSON.stringify(self?.result)).toContain("숨긴행선지");
    expect(lines("hidden-self-view")).toEqual(["막차 다음 날 00:44", null, "늦어도 23:50"]);
    // 막차를 모르는 응답(옛 서버·옛 링크)은 줄이 없다: 그림이 예전과 같다.
    expect(lines("four-fair")).toEqual([null, null, null, null]);
    // 미리보기 설명(og:description, 공유 문구와 같은 말)에는 막차를 넣지 않는다: 그림에만 있다.
    for (const id of ["two-last-train", "four-last-train-middle"]) {
      const c = SHARED_CASES.find((x) => x.id === id);
      if (!c) throw new Error(`표본 없음: ${id}`);
      const description = sharedPreview(toResultView(c.result), c.state)?.description ?? "";
      expect(description, id).not.toMatch(/막차|늦어도/);
    }
  });

  it("뽑기 방에서 뽑은 뒤의 방 링크 이미지(#172): 역·시간·당첨자 강조 없이 이름과 '?'만, 글꼴에 없는 글자 없음", async () => {
    const card = roomShareCopy(ROOM_DRAW_TEASER).card;
    if (!card) throw new Error("그림 데이터 없음");
    expect(card.teaser).toBe(true);
    expect(card.stationCode).toBeUndefined();
    expect(card.people.every((p) => p.minutes === null && !p.favored)).toBe(true);
    const markup = renderToStaticMarkup(<SharedCard data={card} />);
    expect(markup).not.toContain(ROOM_DRAW_TEASER.stage === "result" ? ROOM_DRAW_TEASER.station.stationName : "-");
    expect(markup).not.toMatch(/\d+분/);
    const text = [card.stationName, card.suffix, card.modeLine, OG_TEXT.drawTeaserQuestion, OG_TEXT.drawTeaserMark]
      .concat(card.people.map((p) => p.name))
      .join("");
    expect(missingGlyphs(text)).toEqual([]);
    const drawn = await render(<SharedCard data={card} />);
    expectPng(drawn);
    if (screensDir) writeFileSync(join(screensDir, "og-room-draw-teaser.png"), drawn.bytes);
  });

  it("방 링크 이미지: 결과(배려), 정한 역(약속·숨긴 사람이 정함·경로 없음), 4명, 새벽 약속(02:59·03:00), 글꼴에 없는 글자 없음", async () => {
    for (const { id, preview } of ROOM_CASES) {
      const card = roomShareCopy(preview).card;
      if (!card) throw new Error(`${id}: 그림 데이터 없음`);
      if (preview.stage !== "collecting") expect(card.stationCode, id).toBe(preview.station.stationCode);
      const text = [card.stationName, card.suffix, card.modeLine, ...card.people.map((p) => p.name)].join("");
      expect(missingGlyphs(text), id).toEqual([]);
      const drawn = await render(<SharedCard data={card} />);
      expectPng(drawn);
      if (screensDir) writeFileSync(join(screensDir, `og-${id}.png`), drawn.bytes);
    }
  });

  it("방 링크 이미지의 막차 줄은 켜져 있다(#84): 기본 그림은 켠 그림과 같고, 끄면 막차를 모르던 때와 같은 그림이다", async () => {
    expect(ROOM_PREVIEW_LAST_TRAIN).toBe(true);
    for (const { id, preview } of ROOM_CASES) {
      if (preview.stage === "collecting") continue;
      expect(roomShareCopy(preview).card, id).toEqual(roomShareCopy(preview, { lastTrain: true }).card);
      // 같은 미리보기에서 막차 키만 뺀 것(막차를 모르는 서버가 주는 입력). 끈 그림은 이것과 바이트까지 같다.
      const plain: RoomPreview = {
        ...preview,
        station: { ...preview.station, times: preview.station.times.map(({ lastTrain: _lastTrain, ...time }) => time) },
      };
      const off = roomShareCopy(preview, { lastTrain: false }).card;
      const before = roomShareCopy(plain, { lastTrain: false }).card;
      if (!off || !before) throw new Error(`${id}: 그림 데이터 없음`);
      expect(off, id).toEqual(before);
      expect(JSON.stringify(off.people), id).not.toMatch(/막차|늦어도|다음 날/);
      const [drawn, old] = await Promise.all([render(<SharedCard data={off} />), render(<SharedCard data={before} />)]);
      expect(Buffer.from(drawn.bytes).equals(Buffer.from(old.bytes)), id).toBe(true);
    }
  });

  it("방 링크 이미지의 지도 한가운데 비교(#68 2단계): 서버가 준 1위 단계에만 맨 아래 줄이 있고, 키가 없으면 예전 그림과 같다", async () => {
    for (const { id, preview, middle } of ROOM_CASES) {
      const card = roomShareCopy(preview).card;
      if (!card) throw new Error(`${id}: 그림 데이터 없음`);
      if (preview.stage !== "collecting") expect(card.stationCode, id).toBe(preview.station.stationCode);
      expect(card.middleLine ?? null, id).toBe(middle ?? null);
      if (!card.middleLine || preview.stage !== "result") continue;
      expect(missingGlyphs(card.middleLine), id).toEqual([]);
      // 키를 뺀 미리보기(옛 서버·숨긴 사람이 있는 방·조건 미달)는 비교 줄만 빠진 같은 그림이다.
      const { mapMiddle: _mapMiddle, ...withoutMiddle } = preview;
      const { middleLine: _middleLine, ...rest } = card;
      expect(roomShareCopy(withoutMiddle).card, id).toEqual(rest);
      // 빠른·배려 기준의 방에 값이 와도(옛 서버·버그) 그리지 않는다.
      expect(
        roomShareCopy({ ...preview, basis: { mode: "fast", favorLabel: null } }).card?.middleLine,
        id,
      ).toBeUndefined();
    }
  });

  it("방 링크 이미지의 막차 줄을 켰을 때: 자정을 넘기면 '다음 날', 숨긴 사람·확인 필요·약속 시각까지 떠나는 열차는 줄이 없다", async () => {
    for (const { id, preview, lastTrains } of ROOM_CASES) {
      const card = roomShareCopy(preview, { lastTrain: true }).card;
      if (!card) throw new Error(`${id}: 그림 데이터 없음`);
      expect(missingGlyphs(card.people.map((p) => p.lastTrain ?? "").join("")), id).toEqual([]);
      expect(
        card.people.map((p) => p.lastTrain ?? null),
        id,
      ).toEqual(lastTrains);
      const drawn = await render(<SharedCard data={card} />);
      expectPng(drawn);
      if (screensDir) writeFileSync(join(screensDir, `og-${id}-last-train-on.png`), drawn.bytes);
    }
  });

  it("반반지수 막대 넘침 표본(#202): 6명, 같은 역의 긴 이름, 막차, 두 줄 지도 문장, 기준 줄, 1시간 넘는 한 줄", async () => {
    const names = [
      "동대문역사문화공원 1",
      "동대문역사문화공원 2",
      "디지털미디어시티",
      "우리팀막내생일축하해요 1",
      "우리팀막내생일축하해요 2",
      "강남",
    ];
    const minutes = [94, 88, 61, 57, 72, 90];
    for (const count of [4, 6]) {
      const people = names.slice(0, count).map((name, i) => ({
        name: ogSafeName(name, `참가자 ${i + 1}`),
        minutes: minutes[i] ?? 60,
        favored: false,
        lastTrain: "늦어도 다음 날 00:00",
      }));
      const longest = { kind: "longest" as const, text: "가장 오래 걸리는 사람도 1시간 34분이에요" };
      const scoreboard = {
        stationCode: "9k5",
        stationName: "동대문역사문화공원",
        people,
        modeLine: "공평하게 고름 · 일요일·공휴일 저녁 기준",
        spread: 37,
        title: null,
        compareLine: "지도 한가운데인 동대문역사문화공원역이면 가장 오래 걸리는 사람은 1시간 14분 더 걸려요",
        basisLine: "일요일·공휴일 저녁 기준",
        banban: longest,
      };
      const room = { ...scoreboard, middleLine: scoreboard.compareLine, banban: longest };
      // 반반지수가 꺼진 노선 그림(빨리 만나기 등)의 이름 칸에는 폭 제한이 없어 `ogSafeName`의 길이에만 기댄다.
      const off = {
        ...room,
        banban: null,
        people: people.map((p, i) => (i === 0 ? { ...p, name: ogSafeName("가나다라마바사아자차카 12345678", "") } : p)),
      };
      for (const [kind, element] of [
        ["scoreboard", <ScoreboardCard key="scoreboard" data={scoreboard} />],
        ["room", <SharedCard key="room" data={room} />],
        ["lines", <SharedCard key="lines" data={off} />],
      ] as const) {
        const drawn = await render(element);
        expectPng(drawn);
        if (screensDir) writeFileSync(join(screensDir, `og-banban-stress-${kind}-${String(count)}.png`), drawn.bytes);
      }
    }
  });

  it("같은 내용은 같은 그림이다(정적 생성이 결정적)", async () => {
    const page = pages[0];
    if (!page) throw new Error("표본 없음");
    const [a, b] = [await render(<PairCard page={page} />), await render(<PairCard page={page} />)];
    expect(a.bytes).toEqual(b.bytes);
  });
});
