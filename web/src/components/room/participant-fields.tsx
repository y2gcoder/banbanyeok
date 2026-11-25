"use client";

import { PencilIcon } from "lucide-react";
import { personColor } from "@/components/common/person-color";
import { StationField } from "@/components/common/station-field";
import { MAX_NICKNAME_CODE_POINTS } from "@/lib/link/codec";
import type { ParticipantFormValue } from "@/lib/room/input";

type Props = {
  idPrefix: string;
  value: ParticipantFormValue;
  /**
   * 바뀐 칸만 넘긴다. 부모는 최신 상태에 합친다(`setValue((current) => ({ ...current, ...patch }))`). 이 렌더의 `value`를 펼쳐 넘기면
   * 다시 그리기 전에 두 칸이 잇달아 바뀔 때 뒤의 것이 앞의 것을 옛 값으로 덮는다(#177: 역을 고르자 숨기기가 켜지며 역이 지워짐).
   */
  onChange: (patch: Partial<ParticipantFormValue>) => void;
  /** 노선도 점 색(참여 순서). */
  personIndex: number;
  /**
   * 이미 출발역을 숨긴 사람이 내 항목을 고친다. 새로 숨길 수는 없어서(ADR-0007) 숨기기 칸은 이때만 보이고, 숨김을 유지하거나 풀 수만 있다.
   * 저장한 뒤 풀린 사람에게는 다시 보이지 않는다.
   */
  keepHidden?: boolean;
};

/**
 * 방에서 한 사람이 넣는 정보: 이름(선택), 출발역. 방장 생성·참여·수정이 같이 쓴다.
 * 칸마다 보이는 작은 라벨("이름 (선택)" / "출발역")을 두고 이름 칸도 입력칸 모양(연한 테두리 + 연필)으로 그린다. 굵은 글씨의
 * 테두리 없는 이름 칸이 바로 아래 출발역 칸의 제목처럼 읽히던 문제(W3)를 막는다. 첫 화면의 "나/친구1" 칸과는 다른 화면이다.
 * 출발역 숨기기는 새로 켤 수 없다(ADR-0007). 이미 숨긴 사람([Props.keepHidden])만 지금 상태를 보고 숨김을 풀 수 있다.
 */
export function ParticipantFields({ idPrefix, value, onChange, personIndex, keepHidden = false }: Props) {
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
            <StationField id={stationId} value={value.station} onChange={(station) => onChange({ station })} />
          </div>
        </div>
      </div>
      {keepHidden ? (
        <div className="ml-8 flex items-start gap-2.5">
          <input
            id={hiddenId}
            type="checkbox"
            checked={value.hidden}
            onChange={(e) => onChange({ hidden: e.target.checked })}
            aria-describedby={`${hiddenId}-note`}
            className="mt-0.5 size-5 shrink-0 accent-[var(--ink)]"
          />
          <div className="flex flex-col gap-0.5 text-[15px] text-ink">
            <label htmlFor={hiddenId} className="font-semibold">
              출발역 이름 계속 숨기기
            </label>
            <span id={`${hiddenId}-note`} className="text-[13px] leading-snug text-muted-foreground">
              지금 출발역 이름을 숨기고 있어요. 다른 사람에게는 각 후보까지 걸리는 시간이 5분 단위로 보여서 출발역을
              짐작할 수 있어요. 숨기기는 이제 새로 켤 수 없어서, 끄고 저장하면 다시 숨길 수 없어요.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const FIELD_LABEL = "text-[13px] font-semibold text-ink-soft";
