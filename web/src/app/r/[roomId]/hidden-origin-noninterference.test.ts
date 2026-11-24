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
// What this test checks is what the web layer adds on top of the DTO: no hidden-origin code or name outside the meeting station's
// own name, and the hidden person's coarse time (#142: whole 5 minutes, never 0) reaching the image input unchanged.
describe("hidden origin noninterference through sharing (#143, #157)", () => {
  it("the fixture includes the #142 case: a hidden origin is the meeting station", () => {
    const stations = Object.values(previews).map((wire) => (wire as Computed).station.stationCode);
    expect(stations).toContain("130");
  });

  for (const [scenario, wire] of Object.entries(previews)) {
    it(`${scenario}: metadata, share copy and image input add nothing about the hidden origin`, async () => {
      const preview = structuredClone(wire) as Computed;
      preview.room.roomId = ROOM_ID;
      getRoomPreview.mockResolvedValue(preview);
      const metadata = await generateMetadata({
        params: Promise.resolve({ roomId: ROOM_ID }),
        searchParams: Promise.resolve({ sv: String(preview.room.shareVersion) }),
      });
      const copy = roomShareCopy(preview);
      expect(copy.card).not.toBeNull();
      expect(metadata.openGraph).toMatchObject({ description: copy.preview.description });

      const station = preview.station;
      const hidden = copy.card?.people[HIDDEN_INDEX];
      expect(hidden?.name).toBe("참가자 2");
      if (hidden?.minutes != null) {
        expect(hidden.minutes % 5).toBe(0);
        expect(hidden.minutes).toBeGreaterThanOrEqual(5);
      }
      expect(hidden?.lastTrain).toBeUndefined();

      const output = { metadata, copy, kakao: roomKakaoMessage(ROOM_ID, preview) };
      // The meeting station may be a hidden origin (130 here): its own code and name are the only allowed mentions.
      assertNoOrigin(output, [station.stationCode, station.stationName]);
      // "바로 여기" is the image text for a 0-minute person; nobody in these rooms is at 0 except 지연 at 31a.
      if (station.stationCode !== "31a") expect(JSON.stringify(output)).not.toContain(OG_TEXT.zeroMinutes);
    });
  }
});

function assertNoOrigin(value: unknown, allowed: string[]): void {
  if (typeof value === "string") {
    const rest = allowed.reduce((text, mention) => text.replaceAll(mention, ""), value);
    for (const forbidden of [...HIDDEN_ORIGINS, ...HIDDEN_NAMES]) expect(rest).not.toContain(forbidden);
  } else if (Array.isArray(value)) {
    for (const child of value) assertNoOrigin(child, allowed);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertNoOrigin(key, allowed);
      assertNoOrigin(child, allowed);
    }
  }
}
