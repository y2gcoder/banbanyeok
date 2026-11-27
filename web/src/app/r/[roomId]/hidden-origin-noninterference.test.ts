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
// recorded from a server revision that still served hidden participants (before #182). Servers from #182 on never send a hidden
// participant, so the fixture is frozen: it stands for an older server during a mixed deploy or rollback. The web outputs below
// are computed only from the preview DTO (`getRoomPreview` is the only data source of the metadata), so the same DTO gives the
// same metadata, share copy and image input for both rooms by construction; feeding it twice would only test determinism.
//
// What this test checks is what the web layer adds on top of the DTO: no hidden-origin code or name except where the meeting
// station itself goes, and the hidden person's coarse time (#142: whole 5 minutes, never 0) reaching the image input unchanged.
//
// "Where the meeting station goes" is found structurally, not by deleting the station's name from strings: the same preview is
// rendered again with the station swapped for a sentinel. Then
//   1. that render contains no hidden-origin text at all, in any key or string;
//   2. the sentinel appears only at a path in STATION_SLOTS and the whole string there matches that slot's frame (never in a key);
//   3. for a hidden-origin station, the real render equals that render with the station put back at those slots only.
// Everything else is rejected. The rejection cases at the bottom pin this.

type Output = Awaited<ReturnType<typeof render>>;
type Renderer = (preview: Computed) => Promise<Output>;

const SENTINEL = { stationCode: "qqq", stationName: "만날역" };
const S = SENTINEL.stationName;
const PEOPLE = "(민수|참가자 \\d|지연)";
/** share-copy.ts titles that name the meeting station: `leadingTitle`'s four, the closed-room and the decided title. */
const TITLE = `(${[
  `지금은 ${S}이 제일 (공평해요|빨라요|나아요)`,
  `지금은 ${PEOPLE} 쪽으로 ${S}이 좋아요`,
  `${S}${OG_TEXT.sharedSuffix.replace("?", "\\?")}`,
  `${S}${OG_TEXT.decidedSuffix}`,
].join("|")})`;
const SITE_SUFFIX = " \\| 반반역";
/** The only places (output path → whole-string frame) the meeting station may appear. */
const STATION_SLOTS: Record<string, RegExp> = {
  "copy.card.stationCode": new RegExp(`^${SENTINEL.stationCode}$`),
  "copy.card.stationName": new RegExp(`^${S}$`),
  "copy.preview.title": new RegExp(`^${TITLE}$`),
  "copy.message.title": new RegExp(`^${TITLE}$`),
  "kakao.title": new RegExp(`^${TITLE}$`),
  "metadata.title": new RegExp(`^${TITLE}$`),
  "metadata.openGraph.title": new RegExp(`^${TITLE}${SITE_SUFFIX}$`),
  "metadata.openGraph.images.0.alt": new RegExp(`^${TITLE}$`),
  "metadata.twitter.title": new RegExp(`^${TITLE}${SITE_SUFFIX}$`),
  "metadata.twitter.images.0.alt": new RegExp(`^${TITLE}$`),
};

async function render(preview: Computed) {
  getRoomPreview.mockResolvedValue(preview);
  const metadata = await generateMetadata({
    params: Promise.resolve({ roomId: ROOM_ID }),
    searchParams: Promise.resolve({ sv: String(preview.room.shareVersion) }),
  });
  const copy = roomShareCopy(preview);
  return { metadata, copy, kakao: roomKakaoMessage(ROOM_ID, preview) };
}

const mentionsSentinel = (text: string) => text.includes(S) || text.includes(SENTINEL.stationCode);

/** Throws unless hidden-origin text in [renderer]'s output for [preview] is only where the meeting station goes. */
async function assertOnlyStationSlots(preview: Computed, renderer: Renderer = render): Promise<void> {
  const real = await renderer(preview);
  const blind = structuredClone(preview);
  blind.station = { ...blind.station, ...SENTINEL };
  const template = await renderer(blind);
  assertNoOrigin(template);
  const slots: string[] = [];
  walk(template, (path, text, isKey) => {
    if (!mentionsSentinel(text)) return;
    const frame = isKey ? undefined : STATION_SLOTS[path];
    expect(frame?.test(text) === true, `meeting station at ${isKey ? "key " : ""}${path}: ${text}`).toBe(true);
    slots.push(path);
  });
  const { stationCode, stationName } = preview.station;
  if (HIDDEN_ORIGINS.includes(stationCode)) {
    // 130 takes the same particles as the sentinel ("이", "에서"), so putting it back at the slots gives the real output.
    const filled = structuredClone(template);
    for (const path of slots) {
      const text = get(filled, path) as string;
      set(filled, path, text.replaceAll(S, stationName).replaceAll(SENTINEL.stationCode, stationCode));
    }
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
        /meeting station at copy\.preview\.description/,
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
      [
        "the meeting station as a public person's name",
        leaky((o, input) => {
          const person = o.copy.card?.people[0];
          if (person) person.name = input.station.stationName;
        }),
        /meeting station at copy\.card\.people\.0\.name/,
      ],
      [
        "the meeting station as a public person's last-train line",
        leaky((o, input) => {
          const person = o.copy.card?.people[0];
          if (person) person.lastTrain = input.station.stationName;
        }),
        /meeting station at copy\.card\.people\.0\.lastTrain/,
      ],
      [
        "the meeting station as the OG description",
        leaky((o, input) => {
          o.copy.preview.description = input.station.stationName;
        }),
        /meeting station at copy\.preview\.description/,
      ],
      [
        "the meeting station's code as a key",
        leaky((o, input) => {
          if (o.copy.card) Object.assign(o.copy.card, { [input.station.stationCode]: true });
        }),
        /meeting station at key copy\.card\.qqq/,
      ],
      [
        "the meeting station's title frame at an unlisted path",
        leaky((o) => {
          o.copy.message.text = o.copy.message.title;
        }),
        /meeting station at copy\.message\.text/,
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

/** Visits every key and string with its dotted path ("copy.card.people.0.name"); a key is visited with its own path. */
function walk(value: unknown, visit: (path: string, text: string, isKey: boolean) => void, path = ""): void {
  const at = (key: string | number) => (path === "" ? String(key) : `${path}.${key}`);
  if (typeof value === "string") visit(path, value, false);
  else if (Array.isArray(value)) {
    for (const [i, child] of value.entries()) walk(child, visit, at(i));
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(at(key), key, true);
      walk(child, visit, at(key));
    }
  }
}

function strings(value: unknown): string[] {
  const out: string[] = [];
  walk(value, (_, text) => out.push(text));
  return out;
}

function get(value: unknown, path: string): unknown {
  if (path === "") return value;
  return path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], value);
}

function set(value: unknown, path: string, text: string): void {
  const keys = path.split(".");
  const last = keys.pop() as string;
  (get(value, keys.join(".")) as Record<string, unknown>)[last] = text;
}

/** No allowlist: every key and string at every depth. */
function assertNoOrigin(value: unknown): void {
  for (const text of strings(value)) {
    for (const forbidden of [...HIDDEN_ORIGINS, ...HIDDEN_NAMES]) expect(text, text).not.toContain(forbidden);
  }
}
