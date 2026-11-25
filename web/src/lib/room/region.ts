/**
 * 방의 권역과, 방 참여·고치기 칸이 고를 수 있는 범위(#180). 방 응답에는 권역 필드가 없어(계약에 숨긴 출발역의 권역을 싣지 않는다)
 * 보이는 출발역 코드를 이 웹 빌드의 역 인덱스로 읽는다.
 */
import type { Room } from "@/lib/api/types";
import {
  compareDataVersions,
  INDEX_DATA_VERSION,
  REGIONS_ENABLED,
  type RegionId,
  regionName,
  regionsOf,
} from "@/lib/stations";
import { OPEN_SCOPE, type StationScope } from "@/lib/stations/scope";

const visibleCodes = (room: Room): (string | null)[] => room.participants.map((p) => p.originCode ?? null);

/**
 * 방의 권역. 숨긴 참가자가 있는 옛 방은 수도권 방 규칙을 따른다(ADR-0008). 보이는 출발역이 한 권역이면 그 권역이고,
 * 권역을 모르거나(인덱스에 없는 코드) 이미 섞였으면 null이다.
 */
export function roomRegion(room: Room): RegionId | null {
  if (room.participants.some((p) => p.hidden)) return "capital";
  const regions = regionsOf(visibleCodes(room));
  return regions.length === 1 ? (regions[0] ?? null) : null;
}

/**
 * 방에 참여하거나 내 출발역을 고칠 때의 범위: 방의 권역, 방의 구분. 방이 이 웹 빌드의 인덱스보다 새 데이터로 만들어졌으면
 * (방 dataVersion > 인덱스 dataVersion) 웹의 구분별 출발 가능 정보가 낡았을 수 있어 구분으로는 막지 않는다. 그때는 서버의 409
 * `SCHEDULE_UNAVAILABLE`과 그 문구가 안전망이다. 그 밖에는 막는다: 배포는 서버가 먼저라 서버 데이터는 인덱스보다 오래되지 않는다.
 */
export function roomStationScope(room: Room): StationScope {
  if (!REGIONS_ENABLED) return OPEN_SCOPE;
  const fresh = compareDataVersions(room.dataVersion, INDEX_DATA_VERSION) <= 0;
  return { region: roomRegion(room), slot: fresh ? (room.timeBasis?.timeSlot ?? null) : null };
}

/** 오류 문구가 짚을 권역 이름: 방에 보이는 출발역과 이번에 고른 역의 권역. 숨긴 출발역은 들어가지 않는다. */
export function roomRegionNames(room: Room | undefined, picked?: string | null): string[] {
  return regionsOf([...(room ? visibleCodes(room) : []), picked]).map(regionName);
}
