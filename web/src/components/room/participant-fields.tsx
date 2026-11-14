"use client";

import { personColor } from "@/components/common/person-color";
import { StationField } from "@/components/home/station-field";
import { MAX_NICKNAME_CODE_POINTS } from "@/lib/link/codec";
import type { ParticipantFormValue } from "@/lib/room/input";

type Props = {
  idPrefix: string;
  value: ParticipantFormValue;
  onChange: (next: ParticipantFormValue) => void;
  /** 노선도 점 색(참여 순서). */
  personIndex: number;
  namePlaceholder?: string;
};

/**
 * 방에서 한 사람이 넣는 정보: 이름(선택), 출발역, 출발역 숨기기. 방장 생성·참여·수정이 같이 쓴다.
 * 숨기기는 "역 이름만" 가리고 소요시간·환승은 보인다는 점을 그 자리에서 알린다(product-ux 숨기기 고지).
 */
export function ParticipantFields({ idPrefix, value, onChange, personIndex, namePlaceholder = "이름 (선택)" }: Props) {
  const nameId = `${idPrefix}-name`;
  const stationId = `${idPrefix}-station`;
  const hiddenId = `${idPrefix}-hidden`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <span aria-hidden="true" className="relative flex w-5 shrink-0 justify-center pt-[13px]">
          <span
            className="size-5 rounded-full border-[5px] bg-surface"
            style={{ borderColor: personColor(personIndex) }}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <label htmlFor={nameId} className="sr-only">
            내 이름(선택)
          </label>
          <input
            id={nameId}
            value={value.nickname}
            onChange={(e) => onChange({ ...value, nickname: e.target.value })}
            placeholder={namePlaceholder}
            maxLength={MAX_NICKNAME_CODE_POINTS * 2}
            autoComplete="off"
            className="h-8 w-full min-w-0 rounded-md bg-transparent px-1 text-[15px] font-bold text-ink outline-none placeholder:text-ink-soft focus-visible:bg-surface"
          />
          <label htmlFor={stationId} className="sr-only">
            내 출발역
          </label>
          <StationField id={stationId} value={value.station} onChange={(station) => onChange({ ...value, station })} />
        </div>
      </div>
      <div className="ml-8 flex items-start gap-2.5">
        <input
          id={hiddenId}
          type="checkbox"
          checked={value.hidden}
          onChange={(e) => onChange({ ...value, hidden: e.target.checked })}
          className="mt-0.5 size-5 shrink-0 accent-[var(--ink)]"
        />
        <label htmlFor={hiddenId} className="flex flex-col gap-0.5 text-[15px] text-ink">
          <span className="font-semibold">출발역 이름 숨기기</span>
          <span className="text-[13px] leading-snug text-muted-foreground">
            다른 사람에게는 &lsquo;참가자 N&rsquo;으로 보이고 나에게만 내 출발역이 보여요. 소요시간과 환승 횟수는
            모두에게 보이니, 대략적인 지역은 짐작될 수 있어요.
          </span>
        </label>
      </div>
    </div>
  );
}
