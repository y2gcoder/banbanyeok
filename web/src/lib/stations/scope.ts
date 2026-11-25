/**
 * 출발역 칸이 고를 수 있는 범위(#180). 권역과 구분을 받아 검색 목록, 고를 수 없는 이유, 다른 권역에 있는 역 안내를 정한다.
 * 칸(components/common/station-field.tsx)은 이 결과만 그린다. 범위는 화면이 정한다: 첫 화면·방 만들기는 고른 권역과 구분,
 * 방 참여·고치기는 방의 권역과 구분(lib/room/region.ts).
 */
import { BANDS, DAY_TYPES, slotLabel, slotOf, splitSlot, type TimeSlot } from "@/lib/when/time-slot";
import { unsupportedReason } from "./coverage";
import {
  isExactName,
  REGIONS,
  REGIONS_ENABLED,
  type RegionId,
  regionName,
  type Station,
  searchStations,
  slotGap,
} from "./index";

export type StationScope = {
  /** 이 권역의 역만 찾는다. null이면 모든 권역(권역 화면이 꺼졌거나 방의 권역을 모를 때). */
  region: RegionId | null;
  /** 이 구분에 출발할 수 없는 역은 고를 수 없다. null이면 보지 않는다. */
  slot: TimeSlot | null;
};

export const OPEN_SCOPE: StationScope = { region: null, slot: null };

export type StationChoice = {
  station: Station;
  /** 고를 수 없는 이유. 고를 수 있으면 null. */
  blocked: string | null;
  /** 같은 이름의 다른 권역 역이 함께 보일 때만 붙는 권역 이름. */
  tag: string | null;
};

/** 그 구분에 출발할 수 없는 이유. 요일의 모든 시간대에서 막히면 요일만("토요일"), 아니면 구분("토요일 밤")을 말한다. */
function scheduleReason(station: Station, slot: TimeSlot): string | null {
  const gap = slotGap(station, slot);
  if (!gap) return null;
  if (gap.wholeSlot)
    return `${regionName(station.region)} ${slotLabel(slot)} 시간표를 아직 확인하지 못해 고를 수 없어요`;
  const { day } = splitSlot(slot);
  const wholeDay = BANDS.every((band) => slotGap(station, slotOf(day, band.id)));
  const when = wholeDay ? (DAY_TYPES.find((d) => d.id === day)?.label ?? day) : slotLabel(slot);
  const own = gap.missingServices.filter((line) => station.lines.includes(line));
  const lines = (own.length > 0 ? own : gap.missingServices).join("·");
  return `${when} ${lines} 시간표를 아직 확인하지 못해 고를 수 없어요`;
}

/** 이 범위에서 고를 수 없는 이유(계산하지 않는 역, 다른 권역, 그 구분에 출발할 수 없는 역). 고를 수 있으면 null. */
export function blockedReason(station: Station, scope: StationScope): string | null {
  const unsupported = unsupportedReason(station);
  if (unsupported) return unsupported;
  if (scope.region !== null && station.region !== scope.region) return `${regionName(station.region)} 역이에요`;
  return scope.slot ? scheduleReason(station, scope.slot) : null;
}

/** 범위 안의 검색 결과. 같은 이름이 여러 권역에서 함께 보이면 그 역들에만 권역 이름을 붙인다. */
export function searchInScope(query: string, scope: StationScope, limit = 8): StationChoice[] {
  const stations = searchStations(query, limit, scope.region);
  const regionsByName = new Map<string, Set<RegionId>>();
  for (const s of stations) regionsByName.set(s.name, (regionsByName.get(s.name) ?? new Set()).add(s.region));
  return stations.map((station) => ({
    station,
    blocked: blockedReason(station, scope),
    tag: (regionsByName.get(station.name)?.size ?? 0) > 1 ? regionName(station.region) : null,
  }));
}

export type Elsewhere = {
  region: RegionId;
  name: string;
  /** 고른 권역에도 같은 이름의 역이 있다("부산권에도 시청이 있어요"). */
  alsoHere: boolean;
};

/**
 * 고른 권역 밖에 있는 역을 알릴 한 줄. 범위 안에서 찾지 못하면 다른 권역의 첫 후보를 알린다. 범위 안에 후보가 있으면 다른 권역에
 * 이름이 정확히 같은 역이 있을 때만 알린다: 수도권에서 '기장'을 치면 경기장들이 보여도 부산권 기장을 찾을 수 있어야 한다.
 */
export function elsewhere(query: string, scope: StationScope): Elsewhere | null {
  if (!REGIONS_ENABLED || scope.region === null) return null;
  const others = searchStations(query, 8).filter((s) => s.region !== scope.region && s.supported);
  const here = searchStations(query, 8, scope.region);
  const hit = here.length === 0 ? others[0] : others.find((s) => isExactName(s, query));
  if (!hit) return null;
  return { region: hit.region, name: hit.name, alsoHere: here.some((s) => s.name === hit.name) };
}

/** 권역 이름 목록("수도권", "부산권"). 화면의 권역 고르기 순서다. */
export const REGION_CHOICES: readonly { id: RegionId; name: string }[] = REGIONS.map((id) => ({
  id,
  name: regionName(id),
}));
