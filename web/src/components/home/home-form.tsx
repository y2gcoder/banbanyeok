"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { personColor } from "@/components/common/person-color";
import { preventImplicitRoomSubmit } from "@/components/common/prevent-implicit-room-submit";
import { RegionPicker, useRegionChoice } from "@/components/common/region-choice";
import { StationField } from "@/components/common/station-field";
import { useRecoverableRoom } from "@/components/common/use-recoverable-room";
import { slowMessage } from "@/components/common/use-slow-hint";
import { Button } from "@/components/ui/button";
import { WhenPicker } from "@/components/when/when-picker";
import { track } from "@/lib/analytics";
import { warmUpServer } from "@/lib/api/client";
import type { Mode } from "@/lib/api/types";
import { toShareState } from "@/lib/form/input";
import { parsePrefill, parseRestore } from "@/lib/form/prefill";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { MAX_NICKNAME_CODE_POINTS, MAX_PEOPLE, MIN_PEOPLE } from "@/lib/link/codec";
import { meetingForSlot, toFilledRoomRequest } from "@/lib/room/draw-room";
import { isDrawRoomUnsupported, roomErrorMessage } from "@/lib/room/errors";
import { REGIONS_ENABLED, type Station, stationByCode } from "@/lib/stations";
import { blockedReason, type StationScope } from "@/lib/stations/scope";
import { formatMeetingDay, todayInSeoul } from "@/lib/when/dates";
import { DEFAULT_SLOT, slotNow, type TimeSlot } from "@/lib/when/time-slot";

/**
 * 이름 칸의 안내 문구(placeholder)와 칸 이름. **표시 이름이 아니다**: 결과·공유 화면의 이름은 서버가 만든 label이다
 * (contracts/data-format.md §8). 이름을 비워 두면 서버로 보내지 않는다.
 */
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
  const formId = useId();
  const startedAt = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(0), emptyRow(1)]);
  const [error, setError] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [hostKey, setHostKey] = useState(0);
  const duration = useRef(0);
  const creation = useRecoverableRoom("filled", (input) => {
    saveRememberedMe({ code: input.host.originCode, nickname: input.host.nickname ?? "" });
    track("input_completed", {
      participant_count: 1 + input.others.length,
      has_custom_name: [input.host, ...input.others].some((person) => Boolean(person.nickname)),
      mode: input.mode ?? "fair",
      input_ms: duration.current,
    });
  });
  // 기본값은 지금(서울) 시각의 구분이다. 서버 렌더에는 시각이 없으므로 평일 낮으로 그리고, 열리자마자 지금으로 바꾼다.
  const [slot, setSlot] = useState<TimeSlot>(DEFAULT_SLOT);
  const [slotIsNow, setSlotIsNow] = useState(false);
  // 입력 화면에는 모드를 고르는 곳이 없다. 결과에서 "다시 입력"으로 돌아왔을 때 그 모드(와 배려하던 사람)를 이어 가려고만 들고 있다.
  const [mode, setMode] = useState<Mode>("fair");
  // 인원 상한 안내: 같은 화면에서 여러 번 눌러도 통계는 한 번만 보낸다.
  const [limitNoteShown, setLimitNoteShown] = useState(false);
  const limitReported = useRef(false);
  const [focusKey, setFocusKey] = useState<number | null>(null);
  // 권역(#180): 검색은 고른 권역 안에서. 바꾸면 고른 출발역을 지운다(있으면 먼저 묻는다).
  const regionChoice = useRegionChoice({
    picked: rows.some((row) => row.station),
    clear: () => setRows((current) => current.map((row) => ({ ...row, station: null }))),
  });
  const { adopt } = regionChoice;
  const scope = useMemo<StationScope>(
    () => (REGIONS_ENABLED ? { region: regionChoice.region, slot } : { region: null, slot: null }),
    [regionChoice.region, slot],
  );

  useEffect(() => {
    startedAt.current = performance.now();
    setToday(todayInSeoul());
    setSlot(slotNow());
    setSlotIsNow(true);
    // 서버(Cloud Run min 0)를 미리 깨운다. 입력하는 동안 콜드스타트가 끝난다.
    void warmUpServer();
    // 결과의 "다시 입력"이 보낸 주소(`/?v=2&o=…&m=…&t=…&n=…`)면 모든 줄·모드·구분을 그대로 되살린다.
    const restored = parseRestore(window.location.search);
    if (restored) {
      const region = restored.rows.find((row) => row.station)?.station?.region;
      if (region) adopt(region);
      setRows(restored.rows.map((row, key) => ({ key, ...row })));
      setSlot(restored.slot);
      setSlotIsNow(false);
      setMode(restored.mode);
      return;
    }
    // SEO 페이지가 보낸 `/?o=<코드>.<코드>`가 있으면 그 역으로 채운다(기억해 둔 "나"보다 우선).
    const prefilled = parsePrefill(window.location.search);
    if (prefilled[0]) {
      adopt(prefilled[0].region);
      setRows(rowsFor(prefilled));
      return;
    }
    const me = loadRememberedMe();
    const station = me ? stationByCode(me.code) : undefined;
    if (me && station?.supported) {
      adopt(station.region);
      setRows((current) =>
        current.map((row, i) => (i === 0 && !row.station ? { ...row, nickname: me.nickname, station } : row)),
      );
    }
  }, [adopt]);

  useEffect(() => {
    if (focusKey === null) return;
    document.getElementById(`${formId}-name-${focusKey}`)?.focus();
    setFocusKey(null);
  }, [focusKey, formId]);

  const hostRowIndex = rows.findIndex((person) => person.key === hostKey);
  const meeting = useMemo(() => {
    if (!today) return null;
    try {
      return meetingForSlot(slot, today);
    } catch {
      return null;
    }
  }, [slot, today]);
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
    const blocked = rows.map((row) => (row.station ? blockedReason(row.station, scope) : null)).find(Boolean);
    if (blocked) {
      setError(`${blocked}. 출발역이나 요일·시간대를 바꿔 주세요.`);
      return;
    }
    const result = toShareState(
      rows.map((row) => ({ nickname: row.nickname, code: row.station?.code ?? null, favored: row.favored === true })),
      slot,
      mode,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const hostPosition = rows.filter((row) => row.station).findIndex((row) => row.key === hostKey);
    if (hostPosition < 0) {
      setError("내 칸에 출발역을 넣어 주세요.");
      return;
    }
    const currentDay = todayInSeoul();
    if (today !== currentDay) {
      setToday(currentDay);
      setError("날짜가 바뀌었어요. 약속일을 확인하고 다시 눌러 주세요.");
      return;
    }
    if (!meeting) {
      setError("30일 이내에 이 요일의 약속일이 없어요. 다른 요일을 골라 주세요.");
      return;
    }
    setError(null);
    duration.current = Math.round(performance.now() - startedAt.current);
    void creation.submit(toFilledRoomRequest(result.state, hostPosition, today));
  };

  return (
    <form
      onSubmit={submit}
      onKeyDown={preventImplicitRoomSubmit}
      method="post"
      noValidate
      className="flex flex-col gap-4"
    >
      <fieldset disabled={creation.submitted} className="flex min-w-0 flex-col gap-5">
        <legend className="sr-only">출발역과 약속 정하기</legend>
        <RegionPicker id={`${formId}-region`} choice={regionChoice} />
        <ol className="relative flex flex-col gap-4">
          {rows.map((row, index) => {
            const isHost = row.key === hostKey;
            const friendNumber = index + (hostRowIndex > index ? 1 : 0);
            const placeholder = isHost ? "나" : `친구${friendNumber}`;
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
                  <p className="text-xs font-semibold text-ink-soft">
                    {isHost ? "내 칸 · 방장" : `친구 ${friendNumber}`}
                  </p>
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
                          if (isHost) setHostKey(rows[0]?.key ?? 0);
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
                  <StationField
                    id={stationId}
                    value={row.station}
                    onChange={(station) => update(row.key, { station })}
                    scope={scope}
                    onSwitchRegion={regionChoice.request}
                  />
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

        <fieldset className="flex flex-wrap gap-x-4 gap-y-1">
          <legend className="text-[15px] font-bold text-ink">내 칸 고르기</legend>
          {rows.map((row, index) => (
            <label key={row.key} className="inline-flex min-h-12 items-center gap-2 text-sm font-semibold">
              <input
                type="radio"
                name={`${formId}-host`}
                checked={row.key === hostKey}
                onChange={() => {
                  setHostKey(row.key);
                  setError(null);
                }}
                className="size-4 accent-ink"
              />
              {index + 1}번{row.nickname.trim() ? ` · ${row.nickname.trim()}` : ""}
            </label>
          ))}
        </fieldset>

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
      </fieldset>
      <p id={`${formId}-storage`} className="rounded-xl bg-platform p-3 text-sm leading-relaxed text-ink">
        친구의 출발역과 이름(선택)이 저장돼요. 방 링크를 가진 사람은 방에서 이름·출발역·각자 걸리는 시간을 볼 수 있어요.{" "}
        {meeting?.meetingDate
          ? `약속일은 ${formatMeetingDay(meeting.meetingDate)}이고 그다음 날 방이 지워져요.`
          : "마지막 변경 후 7일에 방이 지워져요(만든 뒤 최대 30일)."}{" "}
        방장은 언제든 방을 지우거나 친구의 칸을 뺄 수 있어요.
      </p>
      {error || creation.error ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error ??
            (isDrawRoomUnsupported(creation.error)
              ? "지금은 이 방식으로 방을 만들 수 없어요. 잠시 뒤에 같은 입력으로 다시 시도해 주세요."
              : roomErrorMessage(creation.error))}
        </p>
      ) : null}
      {creation.attemptBlocked ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          이 기기에 방장 권한을 보관할 준비를 못 했어요. 브라우저 저장 공간을 확인해 주세요.
        </p>
      ) : null}
      {creation.unsaved ? (
        <>
          <p role="alert" className="text-sm font-semibold text-destructive">
            방은 만들었지만 방장 권한을 이 기기에 저장하지 못했어요. 권한을 다시 저장하거나 만든 방을 지워 주세요.
            {creation.saveRetried ? " 아직 저장하지 못했어요." : null}
            {creation.removeError ? ` 방을 지우지 못했어요. ${roomErrorMessage(creation.removeError)}` : null}
          </p>
          <Button type="button" disabled={creation.removePending} onClick={creation.retrySave}>
            권한 다시 저장하기
          </Button>
          <Button type="button" variant="ghost" disabled={creation.removePending} onClick={creation.removeCreated}>
            {creation.removePending ? "지우는 중…" : "만든 방 지우기"}
          </Button>
        </>
      ) : (
        <Button
          type="submit"
          aria-describedby={`${formId}-storage`}
          disabled={creation.submitted || !today}
          className="h-14 rounded-xl text-[17px] font-bold"
        >
          {creation.pending ? "방 만드는 중…" : "방 만들기"}
        </Button>
      )}
      {creation.removed || creation.pending ? (
        <p role="status" className="text-sm text-ink-soft">
          {creation.removed ? "만든 방을 지웠어요." : slowMessage(creation.stage, "방 만들기")}
        </p>
      ) : null}
    </form>
  );
}
