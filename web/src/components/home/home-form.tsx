"use client";

import { PlusIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { personColor } from "@/components/common/person-color";
import { StationField } from "@/components/common/station-field";
import { Button } from "@/components/ui/button";
import { WhenPicker } from "@/components/when/when-picker";
import { track } from "@/lib/analytics";
import { warmUpServer } from "@/lib/api/client";
import type { Mode } from "@/lib/api/types";
import { toShareState } from "@/lib/form/input";
import { parsePrefill, parseRestore } from "@/lib/form/prefill";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { MAX_NICKNAME_CODE_POINTS, MAX_PEOPLE, MIN_PEOPLE } from "@/lib/link/codec";
import { resultPath } from "@/lib/result/share-url";
import { NEW_ROOM_PATH } from "@/lib/room/id";
import { type Station, stationByCode } from "@/lib/stations";
import { DEFAULT_SLOT, slotNow, type TimeSlot } from "@/lib/when/time-slot";

/**
 * 이름 칸의 안내 문구(placeholder)와 칸 이름. **표시 이름이 아니다**: 결과·공유 화면의 이름은 서버가 만든 label이다
 * (contracts/data-format.md §8). 이름을 비워 두면 서버로 보내지 않는다.
 */
const INPUT_PLACEHOLDERS = ["나", "친구1", "친구2", "친구3"] as const;

type Row = { key: number; nickname: string; station: Station | null; favored?: boolean };

const LIMIT_BUTTON = `${MAX_PEOPLE}명까지 돼요 · 더 필요해요?`;
const LIMIT_NOTE = `지금은 ${MAX_PEOPLE}명까지예요. 더 필요하다는 의견을 모으고 있어요.`;

const emptyRow = (key: number): Row => ({ key, nickname: "", station: null });
// 줄 키는 서버·클라이언트 렌더에서 같아야 한다(수화 일치). 새 줄은 지금 가장 큰 키 + 1.
/** 미리 채울 역으로 줄을 만든다(최소 인원까지는 빈 줄로 채운다). */
function rowsFor(stations: readonly Station[]): Row[] {
  const rows: Row[] = stations.map((station, key) => ({ ...emptyRow(key), station }));
  while (rows.length < MIN_PEOPLE) rows.push(emptyRow(rows.length));
  return rows;
}

export function HomeForm() {
  const router = useRouter();
  const formId = useId();
  const startedAt = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(0), emptyRow(1)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // 기본값은 지금(서울) 시각의 구분이다. 서버 렌더에는 시각이 없으므로 평일 낮으로 그리고, 열리자마자 지금으로 바꾼다.
  const [slot, setSlot] = useState<TimeSlot>(DEFAULT_SLOT);
  const [slotIsNow, setSlotIsNow] = useState(false);
  // 입력 화면에는 모드를 고르는 곳이 없다. 결과에서 "다시 입력"으로 돌아왔을 때 그 모드(와 배려하던 사람)를 이어 가려고만 들고 있다.
  const [mode, setMode] = useState<Mode>("fair");
  // 인원 상한 안내: 같은 화면에서 여러 번 눌러도 통계는 한 번만 보낸다.
  const [limitNoteShown, setLimitNoteShown] = useState(false);
  const limitReported = useRef(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);

  useEffect(() => {
    startedAt.current = performance.now();
    setSlot(slotNow());
    setSlotIsNow(true);
    // 서버(Cloud Run min 0)를 미리 깨운다. 입력하는 동안 콜드스타트가 끝난다.
    void warmUpServer();
    // 결과의 "다시 입력"이 보낸 주소(`/?v=2&o=…&m=…&t=…&n=…`)면 모든 줄·모드·구분을 그대로 되살린다.
    const restored = parseRestore(window.location.search);
    if (restored) {
      setRows(restored.rows.map((row, key) => ({ key, ...row })));
      setSlot(restored.slot);
      setSlotIsNow(false);
      setMode(restored.mode);
      return;
    }
    // SEO 페이지가 보낸 `/?o=<코드>.<코드>`가 있으면 그 역으로 채운다(기억해 둔 "나"보다 우선).
    const prefilled = parsePrefill(window.location.search);
    if (prefilled.length > 0) {
      setRows(rowsFor(prefilled));
      return;
    }
    const me = loadRememberedMe();
    const station = me ? stationByCode(me.code) : undefined;
    if (me && station?.supported) {
      setRows((current) =>
        current.map((row, i) => (i === 0 && !row.station ? { ...row, nickname: me.nickname, station } : row)),
      );
    }
  }, []);

  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(`${formId}-name-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, formId]);

  const filled = rows.filter((row) => row.station).length;
  const update = (key: number, patch: Partial<Row>) => {
    setError(null);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  // 줄을 더하면 그 줄의 이름 칸으로 포커스를 옮긴다(4번째 줄에서는 누른 버튼이 안내 버튼으로 바뀌어 포커스가 body로 떨어진다).
  const addRow = () => {
    const key = Math.max(-1, ...rows.map((r) => r.key)) + 1;
    setRows((current) => [...current, emptyRow(key)]);
    setFocusKey(key);
  };

  const wantMorePeople = () => {
    setLimitNoteShown(true);
    if (limitReported.current) return;
    limitReported.current = true;
    track("people_limit_hit", { surface: "home", attempted: MAX_PEOPLE + 1 });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = toShareState(
      rows.map((row) => ({ nickname: row.nickname, code: row.station?.code ?? null, favored: row.favored === true })),
      slot,
      mode,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const first = rows[0];
    if (first?.station) saveRememberedMe({ code: first.station.code, nickname: first.nickname.trim() });
    track("input_completed", {
      participant_count: result.state.origins.length,
      has_custom_name: result.state.nicknames !== null,
      mode: result.state.mode,
      input_ms: Math.round(performance.now() - startedAt.current),
    });
    setPending(true);
    router.push(resultPath(result.state));
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <ol className="relative flex flex-col gap-4">
        {rows.map((row, index) => {
          const placeholder = INPUT_PLACEHOLDERS[index] ?? `친구${index}`;
          const nameId = `${formId}-name-${row.key}`;
          const stationId = `${formId}-station-${row.key}`;
          return (
            <li key={row.key} className="relative flex gap-3">
              {/* 노선도처럼 사람마다 색이 있는 역 점과, 다음 사람으로 이어지는 선 */}
              <span aria-hidden="true" className="relative flex w-5 shrink-0 justify-center pt-3">
                <span
                  className="relative z-10 size-5 rounded-full border-[5px] bg-surface"
                  style={{ borderColor: personColor(index) }}
                />
                {index < rows.length - 1 ? (
                  <span className="absolute top-[30px] -bottom-[30px] w-[3px] rounded-full bg-rule-strong" />
                ) : null}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <label htmlFor={nameId} className="sr-only">
                    {index + 1}번째 사람 이름(선택)
                  </label>
                  <input
                    id={nameId}
                    value={row.nickname}
                    onChange={(e) => update(row.key, { nickname: e.target.value })}
                    placeholder={placeholder}
                    maxLength={MAX_NICKNAME_CODE_POINTS * 2}
                    autoComplete="off"
                    className="h-11 w-full min-w-0 rounded-md bg-transparent px-1 text-[16px] font-bold text-ink placeholder:text-ink-soft focus-visible:bg-surface"
                  />
                  {index >= MIN_PEOPLE ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLimitNoteShown(false);
                        setRows((current) => current.filter((r) => r.key !== row.key));
                      }}
                      className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-ink"
                    >
                      <XIcon className="size-4" aria-hidden="true" />
                      <span className="sr-only">{row.nickname.trim() || placeholder} 빼기</span>
                    </button>
                  ) : null}
                </div>
                <label htmlFor={stationId} className="sr-only">
                  {row.nickname.trim() || placeholder}의 출발역
                </label>
                <StationField id={stationId} value={row.station} onChange={(station) => update(row.key, { station })} />
              </div>
            </li>
          );
        })}
      </ol>

      {rows.length < MAX_PEOPLE ? (
        <button
          type="button"
          onClick={addRow}
          className="ml-8 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-md px-1 text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          <PlusIcon className="size-4" aria-hidden="true" />한 명 더 (최대 {MAX_PEOPLE}명)
        </button>
      ) : (
        // 4명이 차도 자리를 비우지 않는다: 더 넣으려던 사람이 있었는지(인원 상한 수요)를 한 번 센다. 눈에 덜 띄게 둔다.
        <div className="ml-8 flex flex-col items-start">
          <button
            type="button"
            onClick={wantMorePeople}
            className="inline-flex min-h-11 w-fit items-center rounded-md px-1 text-[14px] text-muted-foreground underline-offset-4 hover:text-ink hover:underline"
          >
            {LIMIT_BUTTON}
          </button>
          {/* 안내는 닫히지 않는다: 버튼 상태가 아니라 알림 영역으로만 전한다. 영역은 항상 그려 두고 내용만 채워야 스크린리더가 읽는다. */}
          <p role="status" className="px-1 text-[13px] leading-snug text-muted-foreground">
            {limitNoteShown ? LIMIT_NOTE : null}
          </p>
        </div>
      )}

      <WhenPicker
        id={`${formId}-when`}
        value={slot}
        onChange={(next) => {
          setSlot(next);
          setSlotIsNow(false);
        }}
        note={
          slotIsNow
            ? "지금 시각으로 골라 뒀어요. 약속 때와 다르면 바꿔 주세요. 요일·시간대마다 열차 간격이 달라 시간이 바뀌어요."
            : "요일·시간대마다 열차 간격이 달라 기다리는 시간이 바뀌어요."
        }
      />

      {error ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={filled < MIN_PEOPLE || pending} className="h-14 rounded-xl text-[17px] font-bold">
        {pending ? "찾는 중…" : "만날 역 찾기"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">가입은 필요 없어요.</p>
      <Link
        href={NEW_ROOM_PATH}
        className="flex flex-col gap-0.5 rounded-xl border border-rule-strong bg-surface px-4 py-3.5 hover:border-ink"
      >
        <span className="text-[16px] font-bold text-ink">방 만들어서 각자 입력하기 →</span>
        <span className="text-[13px] leading-snug text-muted-foreground">
          링크를 보내면 친구가 자기 출발역을 직접 넣어요.
        </span>
      </Link>
    </form>
  );
}
