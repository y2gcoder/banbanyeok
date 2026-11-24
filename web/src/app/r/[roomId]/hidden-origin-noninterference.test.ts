import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomPreview } from "@/lib/api/types";
import { OG_TEXT } from "@/lib/copy/og-text";
import { roomKakaoMessage, roomShareCopy } from "@/lib/room/share-copy";
import previews from "../../../../../contracts/fixtures/hidden-origin-noninterference.json";

const getRoomPreview = vi.fn<(roomId: string) => Promise<RoomPreview>>();
vi.mock("@/lib/api/rooms", () => ({ getRoomPreview: (roomId: string) => getRoomPreview(roomId) }));
const { generateMetadata } = await import("./page");

afterEach(() => getRoomPreview.mockReset());

const HIDDEN_ORIGINS = ["130", "225"];
const HIDDEN_NAMES = ["동쪽비공개역", "서쪽비공개역"];
/** The hidden person's position in the fixture rooms (민수, hidden, 지연). */
const HIDDEN_INDEX = 1;
const ROOM_ID = "abcdefghjk";
type Computed = Exclude<RoomPreview, { stage: "collecting" }>;

// What this test does NOT do: compare a room with hidden origin 130 against one with 225. There is one wire DTO per scenario,
// and Kotlin's HiddenOriginNoninterferenceHttpTest proves that BOTH hidden origins produce exactly that DTO (it fails if either
// room's preview differs from this fixture, and it writes the fixture: `mise run fixtures:hidden-origin`). The web outputs below
// are computed only from the preview DTO (`getRoomPreview` is the only data source of the metadata), so the same DTO gives the
// same metadata, share copy and image input for both rooms by construction; feeding it twice would only test determinism.
//
// What this test checks is what the web layer adds on top of the DTO: no hidden-origin code or name except where the meeting
// station itself goes, and the hidden person's coarse time (#142: whole 5 minutes, never 0) reaching the image input unchanged.
//
// "Where the meeting station goes" is found structurally, not by deleting the station's name from every string: the same
// preview is rendered again with the station swapped for a sentinel. That render must contain no hidden-origin text at all, the
// real render must be exactly that render with the station put back in the sentinel's places, and every string holding the
// sentinel must be a station field or one of the pinned sentence frames below.

type Output = Awaited<ReturnType<typeof render>>;
type Renderer = (preview: Computed) => Promise<Output>;

const SENTINEL = { stationCode: "qqq", stationName: "만날역" };
const S = SENTINEL.stationName;
const PEOPLE = "(민수|참가자 \\d|지연)";
/** The only places a meeting station's name may appear (share-copy.ts titles), with or without the site suffix. */
const STATION_FRAMES = [
  `^${S}$`,
  `^${SENTINEL.stationCode}$`,
  `^지금은 ${S}이 제일 (공평해요|빨라요)`,
  `^지금은 ${PEOPLE} 쪽으로 ${S}이 좋아요`,
  `^${S}에서 만나요`,
].map((frame) => new RegExp(`${frame}( \\| 반반역)?$`));

async function render(preview: Computed) {
  getRoomPreview.mockResolvedValue(preview);
  const metadata = await generateMetadata({
    params: Promise.resolve({ roomId: ROOM_ID }),
    searchParams: Promise.resolve({ sv: String(preview.room.shareVersion) }),
  });
  const copy = roomShareCopy(preview);
  return { metadata, copy, kakao: roomKakaoMessage(ROOM_ID, preview) };
}

/** Throws unless hidden-origin text in [renderer]'s output for [preview] is only where the meeting station goes. */
async function assertOnlyStationSlots(preview: Computed, renderer: Renderer = render): Promise<void> {
  const real = await renderer(preview);
  const blind = structuredClone(preview);
  blind.station = { ...blind.station, ...SENTINEL };
  const template = await renderer(blind);
  assertNoOrigin(template);
  for (const text of strings(template)) {
    if (text.includes(S) || text.includes(SENTINEL.stationCode)) {
      expect(
        STATION_FRAMES.some((frame) => frame.test(text)),
        text,
      ).toBe(true);
    }
  }
  const { stationCode, stationName } = preview.station;
  if (HIDDEN_ORIGINS.includes(stationCode)) {
    // 130 takes the same particles as the sentinel ("이", "에서"), so putting it back must give the real output exactly.
    const filled = mapStrings(template, (text) =>
      text.replaceAll(S, stationName).replaceAll(SENTINEL.stationCode, stationCode),
    );
    expect(real).toEqual(filled);
  } else {
    // Not a hidden origin: no allowance at all.
    assertNoOrigin(real);
  }
}

describe("hidden origin noninterference through sharing (#143, #157)", () => {
  it("the fixture includes the #142 case: a hidden origin is the meeting station", () => {
    const stations = Object.values(previews).map((wire) => (wire as Computed).station.stationCode);
    expect(stations).toContain("130");
  });

  for (const [scenario, wire] of Object.entries(previews)) {
    it(`${scenario}: metadata, share copy and image input add nothing about the hidden origin`, async () => {
      const preview = fixturePreview(wire);
      const { metadata, copy } = await render(preview);
      expect(copy.card).not.toBeNull();
      expect(metadata.openGraph).toMatchObject({ description: copy.preview.description });

      const hidden = copy.card?.people[HIDDEN_INDEX];
      expect(hidden?.name).toBe("참가자 2");
      if (hidden?.minutes != null) {
        expect(hidden.minutes % 5).toBe(0);
        expect(hidden.minutes).toBeGreaterThanOrEqual(5);
      }
      expect(hidden?.lastTrain).toBeUndefined();

      await assertOnlyStationSlots(preview);
      // "바로 여기" is the image text for a 0-minute person; nobody in these rooms is at 0 except 지연 at 31a.
      if (preview.station.stationCode !== "31a") {
        expect(JSON.stringify(await render(preview))).not.toContain(OG_TEXT.zeroMinutes);
      }
    });
  }

  describe("the slot check rejects leaks when the meeting station is hidden origin 130", () => {
    const preview = fixturePreview(previews["result/1/0//preview"]);
    const leaky =
      (leak: (output: Output, preview: Computed) => void): Renderer =>
      async (input) => {
        const output = await render(input);
        leak(output, input);
        return output;
      };
    // Each case also names the text the check must fail on, so a rejection for an unrelated reason does not count.
    const leaks: [string, Renderer, RegExp][] = [
      [
        "the station's own name in the OG description",
        leaky((o) => {
          o.copy.preview.description += " 참가자 2 출발역: 동쪽비공개역";
        }),
        /출발역: 동쪽비공개역/,
      ],
      [
        "the other hidden name in the OG description",
        leaky((o) => {
          o.copy.preview.description += " 참가자 2 출발역: 서쪽비공개역";
        }),
        /출발역: 서쪽비공개역/,
      ],
      [
        "the meeting station named as somebody's origin",
        leaky((o, input) => {
          o.copy.preview.description += ` 참가자 2 출발역: ${input.station.stationName}`;
        }),
        /출발역: 만날역/,
      ],
      [
        "a person's name",
        leaky((o) => {
          const person = o.copy.card?.people[HIDDEN_INDEX];
          if (person) person.name = "동쪽비공개역";
        }),
        /동쪽비공개역/,
      ],
      [
        "an object key",
        leaky((o) => {
          Object.assign(o.metadata, { "130": true });
        }),
        /130/,
      ],
    ];

    it("allows the unmodified output (positive control)", async () => {
      await assertOnlyStationSlots(preview);
    });
    for (const [name, renderer, reason] of leaks) {
      it(`rejects ${name}`, async () => {
        await expect(assertOnlyStationSlots(preview, renderer)).rejects.toThrow(reason);
      });
    }
  });
});

function fixturePreview(wire: unknown): Computed {
  const preview = structuredClone(wire) as Computed;
  preview.room.roomId = ROOM_ID;
  return preview;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) => [key, ...strings(child)]);
  }
  return [];
}

function mapStrings<T>(value: T, f: (text: string) => string): T {
  if (typeof value === "string") return f(value) as T;
  if (Array.isArray(value)) return value.map((child) => mapStrings(child, f)) as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [f(key), mapStrings(child, f)])) as T;
  }
  return value;
}

/** No allowlist: every key and string at every depth. */
function assertNoOrigin(value: unknown): void {
  for (const text of strings(value)) {
    for (const forbidden of [...HIDDEN_ORIGINS, ...HIDDEN_NAMES]) expect(text, text).not.toContain(forbidden);
  }
}
