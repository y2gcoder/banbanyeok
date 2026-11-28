"use client";

import { PencilIcon } from "lucide-react";
import { personColor } from "@/components/common/person-color";
import { StationField } from "@/components/common/station-field";
import { MAX_NICKNAME_CODE_POINTS } from "@/lib/link/codec";
import type { ParticipantFormValue } from "@/lib/room/input";
import type { RegionId } from "@/lib/stations";
import type { StationScope } from "@/lib/stations/scope";

type Props = {
  idPrefix: string;
  value: ParticipantFormValue;
  /**
   * 바뀐 칸만 넘긴다. 부모는 최신 상태에 합친다(`setValue((current) => ({ ...current, ...patch }))`). 이 렌더의 `value`를 펼쳐 넘기면
   * 다시 그리기 전에 두 칸이 잇달아 바뀔 때 뒤의 것이 앞의 것을 옛 값으로 덮는다(#177).
   */
  onChange: (patch: Partial<ParticipantFormValue>) => void;
  /** 노선도 점 색(참여 순서). */
  personIndex: number;
  /** 출발역 칸이 고를 수 있는 범위(권역·구분). */
  scope?: StationScope;
  /** 방 만들기의 "○○권으로 바꾸기". 방 참여·고치기에는 없다(방의 권역을 따른다). */
  onSwitchRegion?: (region: RegionId) => void;
  onInitialStationSearch?: () => void;
  nicknameInputRef?: (input: HTMLInputElement | null) => void;
};

/**
 * 방에서 한 사람이 넣는 정보: 이름(선택), 출발역. 방장 생성·참여·수정이 같이 쓴다.
 * 칸마다 보이는 작은 라벨("이름 (선택)" / "출발역")을 두고 이름 칸도 입력칸 모양(연한 테두리 + 연필)으로 그린다. 굵은 글씨의
 * 테두리 없는 이름 칸이 바로 아래 출발역 칸의 제목처럼 읽히던 문제(W3)를 막는다. 첫 화면의 "나/친구1" 칸과는 다른 화면이다.
 */
export function ParticipantFields({
  idPrefix,
  value,
  onChange,
  personIndex,
  scope,
  onSwitchRegion,
  onInitialStationSearch,
  nicknameInputRef,
}: Props) {
  const nameId = `${idPrefix}-name`;
  const stationId = `${idPrefix}-station`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <span aria-hidden="true" className="relative flex w-5 shrink-0 justify-center pt-0.5">
          <span
            className="size-5 rounded-full border-[5px] bg-surface"
            style={{ borderColor: personColor(personIndex) }}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={nameId} className={FIELD_LABEL}>
              <span className="sr-only">내</span> 이름 (선택)
            </label>
            <div className="relative">
              <PencilIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                ref={nicknameInputRef}
                id={nameId}
                value={value.nickname}
                onChange={(e) => onChange({ nickname: e.target.value })}
                placeholder="예: 민수"
                maxLength={MAX_NICKNAME_CODE_POINTS * 2}
                autoComplete="off"
                className="h-11 w-full min-w-0 rounded-lg border border-rule bg-surface pr-3 pl-9 text-[16px] text-ink placeholder:text-muted-foreground focus-visible:border-ink"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={stationId} className={FIELD_LABEL}>
              <span className="sr-only">내</span> 출발역
            </label>
            <StationField
              id={stationId}
              value={value.station}
              onChange={(station) => onChange({ station })}
              {...(scope ? { scope } : {})}
              {...(onInitialStationSearch ? { onInitialSearch: onInitialStationSearch } : {})}
              {...(onSwitchRegion ? { onSwitchRegion } : {})}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const FIELD_LABEL = "text-[13px] font-semibold text-ink-soft";
