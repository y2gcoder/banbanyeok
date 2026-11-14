"use client";

import { PlusIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { personColor } from "@/components/common/person-color";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/analytics";
import { warmUpServer } from "@/lib/api/client";
import { toShareState } from "@/lib/form/input";
import { parsePrefill } from "@/lib/form/prefill";
import { loadRememberedMe, saveRememberedMe } from "@/lib/form/remember";
import { MAX_NICKNAME_CODE_POINTS, MAX_PEOPLE, MIN_PEOPLE } from "@/lib/link/codec";
import { resultPath } from "@/lib/result/share-url";
import { type Station, stationByCode } from "@/lib/stations";
import { StationField } from "./station-field";

/**
 * 이름 칸의 안내 문구(placeholder)와 칸 이름. **표시 이름이 아니다**: 결과·공유 화면의 이름은 서버가 만든 label이다
 * (contracts/data-format.md §8). 이름을 비워 두면 서버로 보내지 않는다.
 */
const INPUT_PLACEHOLDERS = ["나", "친구1", "친구2", "친구3"] as const;

type Row = { key: number; nickname: string; station: Station | null };

const emptyRow = (key: number): Row => ({ key, nickname: "", station: null });
// 줄 키는 서버·클라이언트 렌더에서 같아야 한다(수화 일치). 새 줄은 지금 가장 큰 키 + 1.
/** 미리 채울 역으로 줄을 만든다(최소 인원까지는 빈 줄로 채운다). */
function rowsFor(stations: readonly Station[]): Row[] {
  const rows: Row[] = stations.map((station, key) => ({ ...emptyRow(key), station }));
  while (rows.length < MIN_PEOPLE) rows.push(emptyRow(rows.length));
  return rows;
}
const withNewRow = (rows: Row[]): Row[] => [...rows, emptyRow(Math.max(-1, ...rows.map((r) => r.key)) + 1)];

export function HomeForm() {
  const router = useRouter();
  const formId = useId();
  const startedAt = useRef(0);
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(0), emptyRow(1)]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    startedAt.current = performance.now();
    // 서버(Cloud Run min 0)를 미리 깨운다. 입력하는 동안 콜드스타트가 끝난다.
    void warmUpServer();
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

  const filled = rows.filter((row) => row.station).length;
  const update = (key: number, patch: Partial<Row>) => {
    setError(null);
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = toShareState(rows.map((row) => ({ nickname: row.nickname, code: row.station?.code ?? null })));
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
    <form onSubmit={submit} noValidate aria-describedby={`${formId}-scope`} className="flex flex-col gap-5">
      <ol className="relative flex flex-col gap-4">
        {rows.map((row, index) => {
          const placeholder = INPUT_PLACEHOLDERS[index] ?? `친구${index}`;
          const nameId = `${formId}-name-${row.key}`;
          const stationId = `${formId}-station-${row.key}`;
          return (
            <li key={row.key} className="relative flex gap-3">
              {/* 노선도처럼 사람마다 색이 있는 역 점과, 다음 사람으로 이어지는 선 */}
              <span aria-hidden="true" className="relative flex w-5 shrink-0 justify-center pt-[13px]">
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
                    className="h-8 w-full min-w-0 rounded-md bg-transparent px-1 text-[15px] font-bold text-ink outline-none placeholder:text-ink-soft focus-visible:bg-surface"
                  />
                  {index >= MIN_PEOPLE ? (
                    <button
                      type="button"
                      onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-ink"
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
          onClick={() => setRows(withNewRow)}
          className="ml-8 inline-flex w-fit items-center gap-1.5 rounded-md px-1 py-1 text-[15px] font-semibold text-ink-soft hover:text-ink"
        >
          <PlusIcon className="size-4" aria-hidden="true" />한 명 더 (최대 {MAX_PEOPLE}명)
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={filled < MIN_PEOPLE || pending} className="h-14 rounded-xl text-[17px] font-bold">
        {pending ? "찾는 중…" : "만날 역 찾기"}
      </Button>
      <p id={`${formId}-scope`} className="text-center text-sm text-muted-foreground">
        수도권 지하철역만 돼요. 가입은 필요 없어요.
      </p>
    </form>
  );
}
