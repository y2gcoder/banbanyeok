import { describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import { resultErrorMessage } from "@/lib/api/errors";
import type { Room } from "@/lib/api/types";
import { roomErrorMessage } from "./errors";
import { roomRegion, roomRegionNames, roomStationScope } from "./region";

/** 계약 픽스처(두 권역)의 인덱스. dataVersion 20261126.1, 서울가 001·교대 002는 수도권, 교대 003·부산가 004·부산나 005는 부산권. */
vi.mock("@/lib/stations/index.gen.json", async () => ({
  default: (await import("@/lib/stations/regional.fixture.gen.json")).default,
}));

const person = (originCode: string | null) => ({ originCode, hidden: false });
const room = (participants: { originCode: string | null; hidden: boolean }[], dataVersion = "20261126.1") =>
  ({
    dataVersion,
    participants,
    timeBasis: { timeSlot: "saturday-evening", requestedTimeSlot: "saturday-evening" },
  }) as unknown as Room;

const problem = (code: string, status: number) => new ApiRequestError(status, code, "서버 문구");

describe("방의 권역", () => {
  it("알려진 출발역의 권역을 쓴다", () => {
    expect(roomRegion(room([person("004"), person("005")]))).toBe("busan");
    expect(roomRegion(room([person(null), person("004")]))).toBe("busan");
  });

  it("이미 섞였거나 모르는 역뿐이면 권역을 정하지 않는다", () => {
    expect(roomRegion(room([person("001"), person("004")]))).toBeNull();
    expect(roomRegion(room([person("zzz")]))).toBeNull();
  });

  it("참여 범위는 방의 권역과 구분이다", () => {
    expect(roomStationScope(room([person("004")]))).toEqual({ region: "busan", slot: "saturday-evening" });
  });

  it("방이 이 웹 빌드의 인덱스보다 새 데이터로 만들어졌으면 구분으로는 막지 않는다(서버 409가 안전망)", () => {
    expect(roomStationScope(room([person("004")], "20261127.1"))).toEqual({ region: "busan", slot: null });
    expect(roomStationScope(room([person("004")], "20261120.3"))).toEqual({
      region: "busan",
      slot: "saturday-evening",
    });
  });
});

describe("권역·시간표 오류 문구", () => {
  it("REGION_MISMATCH: 섞인 두 권역을 웹이 알면 그 이름을, 모르면 공통 문구", () => {
    const error = problem("REGION_MISMATCH", 400);
    expect(roomErrorMessage(error, roomRegionNames(room([person("001")]), "004"))).toBe(
      "수도권 역과 부산권 역은 함께 계산하지 않아요. 같은 권역의 역으로 골라 주세요.",
    );
    expect(roomErrorMessage(error, roomRegionNames(room([person(null)]), "004"))).toBe(
      "한 번에 한 권역 안에서만 계산해요. 같은 권역의 역으로 골라 주세요.",
    );
    expect(resultErrorMessage(error)).toBe("한 번에 한 권역 안에서만 계산해요. 같은 권역의 역으로 골라 주세요.");
  });

  it("SCHEDULE_UNAVAILABLE: 원인이 셋이라 단정하지 않는다(방·직접 추천 같은 문구)", () => {
    const error = problem("SCHEDULE_UNAVAILABLE", 409);
    const text = "이 요일·시간대의 시간표를 아직 확인하지 못해 계산하지 못했어요. 다른 요일이나 시간대로 바꿔 보세요.";
    expect(roomErrorMessage(error, ["수도권", "부산권"])).toBe(text);
    expect(resultErrorMessage(error)).toBe(text);
  });
});
