import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomPreview } from "@/lib/api/types";
import { roomKakaoMessage, roomShareCopy } from "@/lib/room/share-copy";
import previews from "../../../../../contracts/fixtures/hidden-origin-noninterference.json";

const getRoomPreview = vi.fn<(roomId: string) => Promise<RoomPreview>>();
vi.mock("@/lib/api/rooms", () => ({ getRoomPreview: (roomId: string) => getRoomPreview(roomId) }));
const { generateMetadata } = await import("./page");

afterEach(() => getRoomPreview.mockReset());

// Kotlin's whole-response test proves that BOTH hidden origins (130 and 225) produce these exact previews.
// Replaying those wire DTOs here covers the real metadata and the SharedCard input without rendering PNGs.
describe("hidden origin noninterference through sharing (#143)", () => {
  for (const [scenario, wire] of Object.entries(previews)) {
    it(`${scenario}: preserves the whole metadata, share copy and image DTO`, async () => {
      const outputs = [];
      for (const hiddenOrigin of ["130", "225"]) {
        const preview = structuredClone(wire) as RoomPreview;
        // Valid public URL IDs differ between the two rooms; normalize only this known identity.
        const roomId = hiddenOrigin === "130" ? "abcdefghjk" : "abcdefghjm";
        preview.room.roomId = roomId;
        getRoomPreview.mockResolvedValue(preview);
        const metadata = await generateMetadata({
          params: Promise.resolve({ roomId }),
          searchParams: Promise.resolve({ sv: String(preview.room.shareVersion) }),
        });
        const copy = roomShareCopy(preview);
        expect(copy.card).not.toBeNull();
        expect(metadata.openGraph).toMatchObject({ description: copy.preview.description });
        const output = {
          metadata,
          copy,
          imageInput: copy.card,
          kakao: roomKakaoMessage(roomId, preview),
        };
        assertNoOrigin(output);
        outputs.push(JSON.stringify(output).replaceAll(roomId, "ROOM_ID"));
      }
      expect(outputs[0]).toBe(outputs[1]);
    });
  }
});

function assertNoOrigin(value: unknown): void {
  if (typeof value === "string") {
    for (const forbidden of ["130", "225", "동쪽비공개역", "서쪽비공개역"]) expect(value).not.toContain(forbidden);
  } else if (Array.isArray(value)) {
    for (const child of value) assertNoOrigin(child);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      assertNoOrigin(key);
      assertNoOrigin(child);
    }
  }
}
