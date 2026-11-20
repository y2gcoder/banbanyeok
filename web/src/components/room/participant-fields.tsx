"use client";

import { PencilIcon } from "lucide-react";
import { personColor } from "@/components/common/person-color";
import { StationField } from "@/components/common/station-field";
import { MAX_NICKNAME_CODE_POINTS } from "@/lib/link/codec";
import type { ParticipantFormValue } from "@/lib/room/input";

type Props = {
  idPrefix: string;
  value: ParticipantFormValue;
  onChange: (next: ParticipantFormValue) => void;
  /** 노선도 점 색(참여 순서). */
  personIndex: number;
};

/**
 * 방에서 한 사람이 넣는 정보: 이름(선택), 출발역, 출발역 숨기기. 방장 생성·참여·수정이 같이 쓴다.
 * 칸마다 보이는 작은 라벨("이름 (선택)" / "출발역")을 두고 이름 칸도 입력칸 모양(연한 테두리 + 연필)으로 그린다. 굵은 글씨의
 * 테두리 없는 이름 칸이 바로 아래 출발역 칸의 제목처럼 읽히던 문제(W3)를 막는다. 첫 화면의 "나/친구1" 칸과는 다른 화면이다.
 * 숨기기는 "역 이름만" 가리고 소요시간·환승은 보인다는 점을 그 자리에서 알린다(product-ux 숨기기 고지).
 */
export function ParticipantFields({ idPrefix, value, onChange, personIndex }: Props) {
  const nameId = `${idPrefix}-name`;
  const stationId = `${idPrefix}-station`;
  const hiddenId = `${idPrefix}-hidden`;
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
                id={nameId}
                value={value.nickname}
                onChange={(e) => onChange({ ...value, nickname: e.target.value })}
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
              onChange={(station) => onChange({ ...value, station })}
            />
          </div>
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
            다른 사람에게는 출발역이 보이지 않아요. 이름을 넣었으면 그 이름으로, 안 넣었으면 &lsquo;참가자 N&rsquo;으로
            보여요. 나에게만 내 출발역이 보여요. 소요시간과 환승 횟수는 모두에게 보이니, 대략적인 지역은 짐작될 수
            있어요.
          </span>
        </label>
      </div>
    </div>
  );
}

const FIELD_LABEL = "text-[13px] font-semibold text-ink-soft";
