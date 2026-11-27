// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_CASES, ROOM_DRAW_TEASER, ROOM_HOST_ENTERED } from "@/components/og/room-card.cases";
import * as api from "@/lib/api/rooms";
import type { Room, RoomPreview } from "@/lib/api/types";
import { roomShareCopy } from "@/lib/room/share-copy";
import { RoomShareSection } from "./share-section";

vi.mock("@/lib/api/rooms");
vi.mock("@/lib/analytics", async (importOriginal) => ({ ...(await importOriginal<object>()), track: vi.fn() }));

function renderSection(preview: RoomPreview) {
  vi.mocked(api.getRoomPreview).mockResolvedValue(preview);
  const room = {
    roomId: preview.room.roomId,
    shareVersion: preview.room.shareVersion,
    roomHash: "hash",
    participants: [{}, {}, {}],
  } as unknown as Room;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoomShareSection roomId={preview.room.roomId} room={room} />
    </QueryClientProvider>,
  );
}

const hintOf = async () => {
  await screen.findByRole("heading", { name: "링크 다시 보내기" });
  return (await screen.findByText(/카톡 미리보기/)).textContent ?? "";
};

describe("방 공유 칸의 안내", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(ROOM_HOST_ENTERED)(
    "방장이 대신 넣은 방($id)은 실제 미리보기처럼 이름·출발역·각자 시간을 넣지 않는다고 알린다",
    async ({ id, preview }) => {
      renderSection(preview);
      const hint = await hintOf();
      expect(hint).toContain("이름, 출발역, 각자 시간");
      expect(hint).toContain("넣지 않");
      expect(hint).not.toMatch(/이름만 보여요|각자 시간이 보여요/);
      const copy = roomShareCopy(preview);
      if (id === "host-entered-decided") {
        expect(hint).toContain("정한 역과 약속만 보이고");
        expect(copy.card?.stationName).toBe(preview.stage === "decided" ? preview.station.stationName : "");
      } else {
        expect(hint).toContain("방에서 확인하라고만 보여요");
        expect(JSON.stringify(copy)).not.toContain(preview.stage === "result" ? preview.station.stationName : "-");
      }
    },
  );

  it("각자 입력한 방과 뽑기 방은 지금 안내 그대로다", async () => {
    const result = ROOM_CASES.find((c) => c.preview.stage === "result")?.preview;
    if (!result) throw new Error("표본 없음");
    const { unmount } = renderSection(result);
    expect(await hintOf()).toContain("카톡 미리보기에 지금 1위 역과 각자 시간이 보여요");
    unmount();
    renderSection(ROOM_DRAW_TEASER);
    expect(await hintOf()).toContain("숨기고 이름만 보여요");
  });
});
