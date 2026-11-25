"use client";

import { useState } from "react";
import { type DraftStation, REGION_NAME, type Region, SHARED_NAMES, searchBoth, stationNamed } from "./data";
import { type BadgeStyle, PickedStation, QueryInput, ResultList, Section, StationRow, Variant } from "./parts";

type Lock = "dim" | "hide" | "choose";
type Field = { label: string; station: DraftStation | null; query: string };

const other = (r: Region): Region => (r === "capital" ? "busan" : "capital");

/** 부산권 역에는 늘, 수도권 역에는 같은 이름이 부산권에 있을 때 권역 꼬리표를 단다. */
const needsTag = (station: DraftStation) => station.region === "busan" || SHARED_NAMES.has(station.name);

type Results = { rows: DraftStation[]; lockedTo: Region | null; footer: string | null };

/** 한 칸의 검색 결과. `pickedRegion`은 다른 칸에서 이미 고른 역의 권역이다. */
function results(lock: Lock, query: string, pickedRegion: Region | null, chosen: Region): Results {
  if (lock === "dim") return { rows: searchBoth(query), lockedTo: pickedRegion, footer: null };
  if (lock === "hide") {
    if (pickedRegion === null) return { rows: searchBoth(query), lockedTo: null, footer: null };
    const hidden = searchBoth(query, Number.POSITIVE_INFINITY, other(pickedRegion)).length;
    return {
      rows: searchBoth(query, 8, pickedRegion),
      lockedTo: null,
      footer:
        hidden > 0
          ? `${REGION_NAME[other(pickedRegion)]} 역 ${hidden}곳은 뺐어요. 한 번에 한 권역 안에서만 계산해요.`
          : null,
    };
  }
  if (pickedRegion === null) {
    const rows = [...searchBoth(query, 8, chosen), ...searchBoth(query, 8, other(chosen))].slice(0, 8);
    return { rows, lockedTo: null, footer: null };
  }
  const elsewhere = searchBoth(query, 1, other(chosen)).length > 0;
  return {
    rows: searchBoth(query, 8, chosen),
    lockedTo: null,
    footer: elsewhere
      ? `${REGION_NAME[chosen]}에서만 찾고 있어요. ${REGION_NAME[other(chosen)]}이면 위에서 바꿔 주세요.`
      : null,
  };
}

function SearchLockMock({ lock, style, first }: { lock: Lock; style: BadgeStyle; first: DraftStation }) {
  const [fields, setFields] = useState<Field[]>([
    { label: "나의 출발역", station: first, query: "" },
    { label: "친구1의 출발역", station: null, query: "시청" },
  ]);
  const [chosen, setChosen] = useState<Region>(first.region);
  const pickedRegion = fields.find((f) => f.station)?.station?.region ?? null;

  const update = (i: number, next: Partial<Field>) =>
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...next } : f)));
  const pick = (i: number, station: DraftStation) => {
    update(i, { station });
    if (lock === "choose") setChosen(station.region);
  };
  const switchRegion = (r: Region) => {
    setChosen(r);
    setFields((fs) => fs.map((f) => ({ ...f, station: null })));
  };

  return (
    <div className="flex flex-col gap-3">
      {lock === "choose" ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-[13px] font-bold text-ink-soft">어디서 만나요?</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {(["capital", "busan"] as const).map((r) => (
              <label
                key={r}
                className={`flex min-h-10 cursor-pointer items-center justify-center rounded-md text-[15px] font-bold ${
                  chosen === r ? "bg-surface text-ink shadow-sm" : "text-muted-foreground"
                }`}
              >
                <input
                  type="radio"
                  name={`region-${style}`}
                  className="sr-only"
                  checked={chosen === r}
                  onChange={() => switchRegion(r)}
                />
                {REGION_NAME[r]}
              </label>
            ))}
          </div>
          <span className="text-[12px] text-muted-foreground">
            {pickedRegion === null
              ? "아직 고른 역이 없어 두 권역을 함께 찾아요. 처음 고른 역의 권역으로 이 선택이 맞춰져요."
              : "바꾸면 고른 출발역이 지워져요."}
          </span>
        </fieldset>
      ) : null}
      {fields.map((f, i) => {
        if (f.station) {
          return (
            <PickedStation
              key={f.label}
              label={f.label}
              station={f.station}
              style={style}
              onClear={() => update(i, { station: null, query: "" })}
            />
          );
        }
        const otherPick = fields.find((g, j) => j !== i && g.station)?.station?.region ?? null;
        const { rows, lockedTo, footer } = results(lock, f.query, otherPick, chosen);
        return (
          <div key={f.label} className="flex flex-col gap-1">
            <QueryInput label={f.label} value={f.query} onChange={(query) => update(i, { query })} />
            {f.query.trim() ? (
              <ResultList>
                {rows.map((s) => (
                  <StationRow
                    key={s.code}
                    station={s}
                    style={style}
                    tag={needsTag(s)}
                    reason={
                      lockedTo !== null && s.region !== lockedTo
                        ? `첫 출발역이 ${REGION_NAME[lockedTo]}이라 ${REGION_NAME[s.region]} 역은 고를 수 없어요`
                        : null
                    }
                    onPick={() => pick(i, s)}
                  />
                ))}
                {footer ? <li className="px-2 py-1.5 text-xs text-muted-foreground">{footer}</li> : null}
                {rows.length === 0 ? <li className="px-2 py-1.5 text-sm text-ink">찾는 역이 없어요</li> : null}
              </ResultList>
            ) : null}
          </div>
        );
      })}
      {lock !== "choose" && pickedRegion ? (
        <p className="text-[13px] text-ink-soft">
          {REGION_NAME[pickedRegion]} 역끼리 계산해요. 다른 권역에서 만나려면 고른 출발역을 지워 주세요.
        </p>
      ) : null}
    </div>
  );
}

export function SearchLockSection({ style }: { style: BadgeStyle }) {
  const gangnam = stationNamed("강남", "capital");
  return (
    <Section
      n={1}
      title="역 검색과 권역 잠금"
      question="첫 출발역이 수도권(강남)인데 친구 칸에 '시청'을 치면 수도권 시청과 부산 시청이 함께 나와요. 다른 권역 역을 어떻게 다룰까요?"
      note="세 안 모두 같은 이름이 두 권역에 있으면 권역 꼬리표를 붙이고, 노선 배지는 6번의 '부산1' 알약을 써요. 두 칸 모두 입력하면 바로 다시 찾아요. 운영과 같이 계산하지 않는 역(예: 임진강)은 권역과 상관없이 고를 수 없어요."
    >
      <Variant
        id="s1a"
        title="안 A · 보이되 고를 수 없게"
        summary="지금 '계산하지 않는 역'처럼 흐리게 두고 이유를 한 줄 붙여요."
        pros={[
          "지금 화면의 규칙(보이되 못 고름, 이유 한 줄)과 같아요",
          "부산 시청을 찾던 사람이 왜 안 되는지 바로 알아요",
        ]}
        cons={["목록 자리를 고를 수 없는 줄이 차지해요", "이유 문장이 길어 폰에서 두 줄이 돼요"]}
      >
        <SearchLockMock lock="dim" style={style} first={gangnam} />
      </Variant>
      <Variant
        id="s1b"
        title="안 B · 목록에서 빼고 한 줄 알림"
        summary="다른 권역 역은 빼고, 몇 곳을 뺐는지 목록 끝에 알려요."
        pros={["고를 수 있는 역만 보여 목록이 짧아요", "같은 이름 역을 잘못 누를 일이 없어요"]}
        cons={["부산 시청을 찾던 사람은 끝줄을 읽어야 이유를 알아요", "검색 순위와 '없음' 안내가 권역마다 달라져요"]}
      >
        <SearchLockMock lock="hide" style={style} first={gangnam} />
      </Variant>
      <Variant
        id="s1c"
        title="안 C · 권역을 먼저 고르기"
        summary="입력 위에 수도권/부산권 선택을 둬요. 첫 출발역은 두 권역에서 찾고, 고르면 그 권역으로 선택이 맞춰져요."
        pros={[
          "어디서 계산하는지 늘 보여요",
          "첫 출발역을 고른 뒤에는 검색이 한 권역 안에서만 돌아 같은 이름 혼동이 없어요",
        ]}
        cons={[
          "수도권만 쓰는 대부분의 사용자에게 칸 하나가 늘어요",
          "바꾸면 고른 역이 지워져 한 번 더 설명이 필요해요",
        ]}
      >
        <SearchLockMock lock="choose" style={style} first={gangnam} />
      </Variant>
    </Section>
  );
}
