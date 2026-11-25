"use client";

import { useState } from "react";
import { type DraftStation, REGION_NAME, type Region, searchBoth, stationNamed } from "./data";
import { type BadgeStyle, PickedStation, QueryInput, ResultList, Section, StationRow, Variant } from "./parts";

type Lock = "dim" | "hide" | "choose";

const other = (r: Region): Region => (r === "capital" ? "busan" : "capital");

/** 같은 이름이 두 권역에 있으면 두 줄 모두에, 부산권 역에는 늘 권역 꼬리표를 단다. */
function needsTag(station: DraftStation, rows: DraftStation[]): boolean {
  return station.region === "busan" || rows.some((r) => r.name === station.name && r.region !== station.region);
}

function SearchLockMock({ lock, style, first }: { lock: Lock; style: BadgeStyle; first: DraftStation }) {
  const [me, setMe] = useState<DraftStation | null>(first);
  const [friend, setFriend] = useState<DraftStation | null>(null);
  const [query, setQuery] = useState("시청");
  const [chosen, setChosen] = useState<Region>(first.region);
  const locked: Region | null = lock === "choose" ? chosen : ((me ?? friend)?.region ?? null);

  const all = friend ? [] : searchBoth(query);
  const inRegion = all.filter((s) => locked === null || s.region === locked);
  const rows = lock === "dim" ? all : inRegion;
  const hidden = all.length - inRegion.length;

  const switchRegion = (r: Region) => {
    setChosen(r);
    setMe(null);
    setFriend(null);
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
          <span className="text-[12px] text-muted-foreground">바꾸면 고른 출발역이 지워져요.</span>
        </fieldset>
      ) : null}
      {me ? (
        <PickedStation label="나의 출발역" station={me} style={style} onClear={() => setMe(null)} />
      ) : (
        <QueryInput label="나의 출발역" value="" onChange={() => {}} />
      )}
      {friend ? (
        <PickedStation label="친구1의 출발역" station={friend} style={style} onClear={() => setFriend(null)} />
      ) : (
        <div className="flex flex-col gap-1">
          <QueryInput label="친구1의 출발역" value={query} onChange={setQuery} />
          {query.trim() ? (
            <ResultList>
              {rows.map((s) => (
                <StationRow
                  key={s.code}
                  station={s}
                  style={style}
                  tag={needsTag(s, all)}
                  reason={
                    locked !== null && s.region !== locked
                      ? `첫 출발역이 ${REGION_NAME[locked]}이라 ${REGION_NAME[s.region]} 역은 고를 수 없어요`
                      : null
                  }
                  onPick={() => setFriend(s)}
                />
              ))}
              {lock === "hide" && hidden > 0 && locked ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  {REGION_NAME[other(locked)]} 역 {hidden}곳은 뺐어요. 한 번에 한 권역 안에서만 계산해요.
                </li>
              ) : null}
              {lock === "choose" && hidden > 0 ? (
                <li className="px-2 py-1.5 text-xs text-muted-foreground">
                  {REGION_NAME[chosen]}에서만 찾고 있어요. {REGION_NAME[other(chosen)]}이면 위에서 바꿔 주세요.
                </li>
              ) : null}
              {rows.length === 0 ? <li className="px-2 py-1.5 text-sm text-ink">찾는 역이 없어요</li> : null}
            </ResultList>
          ) : null}
        </div>
      )}
      {lock !== "choose" && locked ? (
        <p className="text-[13px] text-ink-soft">
          {REGION_NAME[locked]} 역끼리 계산해요. 다른 권역에서 만나려면 고른 출발역을 지워 주세요.
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
      note="세 안 모두 같은 이름이 두 권역에 있으면 권역 꼬리표를 붙이고, 노선 배지는 6번의 '부산1' 알약을 써요. 입력 칸을 고치면 바로 다시 찾아요."
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
        summary="입력 위에 수도권/부산권 선택을 두고, 첫 출발역을 고르면 자동으로 맞춰요."
        pros={["어디서 계산하는지 늘 보여요", "검색이 한 권역 안에서만 돌아 같은 이름 혼동이 없어요"]}
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
