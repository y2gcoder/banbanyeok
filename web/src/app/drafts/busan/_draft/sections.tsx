"use client";

import { useState } from "react";
import {
  BUSAN_LINES,
  badgeInk,
  CAPITAL_LINE_COUNT,
  DAY_NAME,
  type DayType,
  type DraftStation,
  nearestAvailable,
  REGION_NAME,
  type Region,
  searchBoth,
  stationNamed,
  UNSUPPORTED_COUNT,
} from "./data";
import {
  type BadgeStyle,
  BusanLines,
  CapitalLines,
  Disclosure,
  PickedStation,
  QueryInput,
  RegionTag,
  ResultList,
  Section,
  StationRow,
  Variant,
} from "./parts";

const BUSAN_COUNT = BUSAN_LINES.length;
const CAPITAL_SUMMARY = `수도권 전철 ${CAPITAL_LINE_COUNT}개 노선을 계산해요`;
const BUSAN_SUMMARY = `부산권 전철 ${BUSAN_COUNT}개 노선을 계산해요`;

function NoMatch({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-rule bg-surface p-2 text-[13px]">
      <span className="text-[11px] font-bold text-muted-foreground">검색 결과가 없을 때</span>
      <span className="font-semibold text-ink">찾는 역이 없어요</span>
      <span className="text-ink-soft">{text}</span>
    </div>
  );
}

export function CoverageSection({ style }: { style: BadgeStyle }) {
  const [first, setFirst] = useState<Region | null>(null);
  return (
    <Section
      n={2}
      title="지원 노선 안내(#170)"
      question="첫 화면의 '수도권 전철 N개 노선을 계산해요' 옆에 부산권을 어떻게 놓을까요?"
      note={`수도권 ${CAPITAL_LINE_COUNT}개는 운영 역 인덱스에서 센 값, 부산권 ${BUSAN_COUNT}개는 ADR-0008의 노선(부산1~4호선·부산김해경전철·동해선)이에요.`}
    >
      <Variant
        id="s2a"
        title="안 A · 권역마다 한 줄"
        summary="지금 줄 아래에 부산권 줄을 하나 더 두고 따로 펼쳐요."
        pros={["지금 문장을 그대로 두고 한 줄만 더해요", "대구·대전이 와도 줄만 늘면 돼요"]}
        cons={["권역이 늘수록 제목 아래가 길어져요", "폰 첫 화면에서 입력 칸이 그만큼 밀려요"]}
      >
        <div className="flex flex-col gap-1">
          <Disclosure summary={CAPITAL_SUMMARY} defaultOpen={false}>
            <CapitalLines />
          </Disclosure>
          <Disclosure summary={BUSAN_SUMMARY}>
            <BusanLines style={style} />
          </Disclosure>
          <NoMatch
            text={`아직 수도권 전철 ${CAPITAL_LINE_COUNT}개 노선과 부산권 전철 ${BUSAN_COUNT}개 노선만 계산해요. 이름이 맞는지도 확인해 주세요.`}
          />
        </div>
      </Variant>
      <Variant
        id="s2b"
        title="안 B · 한 줄로 합치고 펼치면 권역별"
        summary={`'수도권 ${CAPITAL_LINE_COUNT}개 · 부산권 ${BUSAN_COUNT}개 노선을 계산해요' 한 줄, 펼치면 권역 제목 아래 배지.`}
        pros={["첫 화면 높이가 지금과 같아요", "두 권역을 한눈에 비교해요"]}
        cons={["권역이 셋을 넘으면 한 줄에 다 안 들어가요", "'전철'이 빠져 문장이 조금 딱딱해요"]}
      >
        <Disclosure summary={`수도권 ${CAPITAL_LINE_COUNT}개 · 부산권 ${BUSAN_COUNT}개 노선을 계산해요`}>
          <span className="text-[13px] font-bold text-ink">수도권</span>
          <CapitalLines />
          <span className="text-[13px] font-bold text-ink">부산권</span>
          <BusanLines style={style} />
        </Disclosure>
        <NoMatch text="아직 수도권·부산권 전철만 계산해요. 이름이 맞는지도 확인해 주세요." />
      </Variant>
      <Variant
        id="s2c"
        title="안 C · 첫 출발역 권역을 따라가기"
        summary="처음엔 B처럼 합친 줄, 첫 출발역을 고르면 그 권역 줄 하나만 보여요."
        pros={["고른 뒤에는 지금 계산하는 범위만 보여요", "권역 잠금(1번)과 같은 말을 해요"]}
        cons={["같은 자리 문장이 바뀌어 눈에 덜 익어요", "공유 링크로 들어온 사람에겐 처음부터 한 권역만 보여요"]}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1 text-[12px]">
            <span className="text-muted-foreground">첫 출발역:</span>
            {([null, "capital", "busan"] as const).map((r) => (
              <button
                key={String(r)}
                type="button"
                aria-pressed={first === r}
                onClick={() => setFirst(r)}
                className={`rounded-md border px-2 py-0.5 ${first === r ? "border-ink font-bold text-ink" : "border-rule text-ink-soft"}`}
              >
                {r === null ? "아직 없음" : r === "capital" ? "강남" : "서면"}
              </button>
            ))}
          </div>
          {first === null ? (
            <Disclosure summary={`수도권 ${CAPITAL_LINE_COUNT}개 · 부산권 ${BUSAN_COUNT}개 노선을 계산해요`}>
              <CapitalLines />
              <BusanLines style={style} />
            </Disclosure>
          ) : (
            <Disclosure
              summary={`${REGION_NAME[first]} 전철 ${first === "capital" ? CAPITAL_LINE_COUNT : BUSAN_COUNT}개 노선으로 계산해요`}
            >
              {first === "capital" ? <CapitalLines /> : <BusanLines style={style} />}
            </Disclosure>
          )}
          <NoMatch
            text={
              first === "busan"
                ? `부산권 전철 ${BUSAN_COUNT}개 노선에서는 찾지 못했어요. 이름이 맞는지도 확인해 주세요.`
                : "아직 수도권·부산권 전철만 계산해요. 이름이 맞는지도 확인해 주세요."
            }
          />
        </div>
      </Variant>
    </Section>
  );
}

type CopySet = {
  subtitle: string;
  scope: string;
  description: string;
  hubLead: string;
  hubGroups: boolean;
  ogSub: string;
};

const CURRENT_COPY: CopySet = {
  subtitle: "각자 지하철 시간으로 계산해요",
  scope: `수도권 전철 ${CAPITAL_LINE_COUNT}개 노선을 계산해요`,
  description: "각자 지하철 시간으로 계산해서 공평하게 만날 역을 찾아요. 가입 없이 링크로 공유해요.",
  hubLead:
    "강남·홍대입구·잠실처럼 자주 만나는 두 역을 골라, 각자 지하철 시간으로 계산한 공평한 만날 곳 3곳을 비교해 보세요.",
  hubGroups: false,
  ogSub: "각자 지하철 시간으로 계산해요",
};

const COPY_VARIANTS: { id: string; title: string; copy: CopySet }[] = [
  {
    id: "a",
    title: "안 A · 문구는 그대로, 범위 줄만",
    copy: {
      ...CURRENT_COPY,
      scope: `수도권 ${CAPITAL_LINE_COUNT}개 · 부산권 ${BUSAN_COUNT}개 노선을 계산해요`,
      hubLead:
        "강남·홍대입구, 서면·해운대처럼 자주 만나는 두 역을 골라, 각자 지하철 시간으로 계산한 공평한 만날 곳 3곳을 비교해 보세요.",
    },
  },
  {
    id: "b",
    title: "안 B · 권역 이름을 앞에",
    copy: {
      subtitle: "수도권·부산권 지하철 시간으로 계산해요",
      scope: `수도권 ${CAPITAL_LINE_COUNT}개 · 부산권 ${BUSAN_COUNT}개 노선을 계산해요`,
      description:
        "수도권과 부산권에서, 각자 지하철 시간으로 계산해 공평하게 만날 역을 찾아요. 가입 없이 링크로 공유해요.",
      hubLead:
        "수도권과 부산권에서 자주 만나는 두 역을 골라, 각자 지하철 시간으로 계산한 공평한 만날 곳 3곳을 비교해 보세요.",
      hubGroups: true,
      ogSub: "수도권·부산권 지하철 시간으로 계산해요",
    },
  },
  {
    id: "c",
    title: "안 C · 브랜드 문구는 그대로, 허브만 권역별",
    copy: {
      ...CURRENT_COPY,
      scope: `수도권 ${CAPITAL_LINE_COUNT}개 · 부산권 ${BUSAN_COUNT}개 노선을 계산해요`,
      hubLead: "자주 만나는 두 역을 권역별로 골랐어요. 각자 지하철 시간으로 계산한 공평한 만날 곳 3곳을 비교해 보세요.",
      hubGroups: true,
    },
  },
];

function CopyMock({ copy }: { copy: CopySet }) {
  return (
    <div className="flex flex-col gap-3 text-ink">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground">첫 화면</span>
        <p className="text-[22px] leading-[1.2] font-extrabold tracking-[-0.03em]">
          우리 어디서 만나면
          <br />딱 반반일까?
        </p>
        <p className="text-[15px] text-ink-soft">{copy.subtitle}</p>
        <p className="text-[13px] font-semibold text-ink-soft underline decoration-rule-strong underline-offset-4">
          {copy.scope}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground">사이트 설명(검색 결과·메타)</span>
        <p className="text-[13px] text-ink-soft">{copy.description}</p>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground">SEO 허브(/meet)</span>
        <p className="text-[17px] font-extrabold">인기 역 조합별 만날 곳</p>
        <p className="text-[13px] text-ink-soft">{copy.hubLead}</p>
        {copy.hubGroups ? (
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <div>
              <p className="font-bold">수도권</p>
              <p className="text-ink-soft">강남에서 출발하면 …</p>
            </div>
            <div>
              <p className="font-bold">부산권</p>
              <p className="text-ink-soft">서면에서 출발하면 …</p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-soft">강남에서 출발하면 … / 서면에서 출발하면 …(한 목록에 섞임)</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground">기본 미리보기 그림(OG)</span>
        <div className="flex aspect-[1200/630] flex-col justify-center gap-1 rounded-lg bg-surface p-4 ring-1 ring-rule">
          <p className="text-[12px] font-extrabold">반반역</p>
          <p className="text-[18px] leading-tight font-extrabold">
            우리 어디서 만나면
            <br />딱 반반일까?
          </p>
          <p className="text-[12px] text-ink-soft">{copy.ogSub}</p>
        </div>
      </div>
    </div>
  );
}

export function CopySection() {
  return (
    <Section
      n={3}
      title="첫 화면·SEO 허브·OG의 '수도권' 표현"
      question="지금 '수도권'이라는 말은 첫 화면의 범위 줄과 '찾는 역이 없어요' 안내에만 있어요. 부제·사이트 설명·OG는 '지하철'만 말하고, 허브 설명은 강남·홍대입구·잠실을 예로 들어요."
    >
      {COPY_VARIANTS.map((v) => (
        <Variant
          key={v.id}
          id={`s3${v.id}`}
          title={v.title}
          summary={
            v.id === "a"
              ? "'지하철'은 부산에도 맞으니 부제·설명·OG는 두고, 범위 줄과 허브 예시만 바꿔요."
              : v.id === "b"
                ? "부제·사이트 설명·OG 부제에 '수도권·부산권'을 넣어 어디서 쓰는지 먼저 말해요."
                : "말은 그대로 두고, 허브를 권역 묶음으로 나눠 부산 조합을 따로 보여 줘요."
          }
          pros={
            v.id === "a"
              ? ["바뀌는 문구가 가장 적어요", "OG 그림·글꼴 서브셋을 다시 만들 필요가 없어요"]
              : v.id === "b"
                ? ["부산 사람이 처음 봐도 쓸 수 있는 곳인지 알아요", "검색 결과 설명에 '부산'이 들어가요"]
                : ["허브에서 부산 조합을 찾기 쉬워요", "브랜드 문구와 OG를 건드리지 않아요"]
          }
          cons={
            v.id === "a"
              ? ["첫 화면에서 부산 지원을 알리는 곳이 범위 줄 하나뿐이에요", "허브가 두 권역을 한 목록에 섞어요"]
              : v.id === "b"
                ? ["권역이 늘면 부제가 계속 길어져요", "OG 그림을 다시 만들고 공유 미리보기 캐시가 바뀌어요"]
                : ["첫 화면만 봐서는 부산 지원을 알기 어려워요", "허브 구조(묶음 제목)를 바꿔야 해요"]
          }
        >
          <CopyMock copy={v.copy} />
        </Variant>
      ))}
    </Section>
  );
}

const ERROR_COPY: {
  code: "REGION_MISMATCH" | "SCHEDULE_UNAVAILABLE";
  where: string;
  current: string;
  variants: { id: string; text: string; note: string }[];
}[] = [
  {
    code: "REGION_MISMATCH",
    where: "방 만들기·참여·출발역 고치기(지금은 서버 문구가 그대로), 직접 추천·옛 공유 링크(지금은 일반 안내)",
    current: "방과 추천은 한 권역 안에서 계산합니다",
    variants: [
      {
        id: "A",
        text: "한 번에 한 권역 안에서만 계산해요. 같은 권역의 역으로 골라 주세요.",
        note: "권역 이름을 말하지 않아 숨긴 출발역의 권역이 드러나지 않아요.",
      },
      {
        id: "B",
        text: "수도권 역과 부산권 역은 함께 계산하지 않아요. 같은 권역의 역으로 골라 주세요.",
        note: "두 권역을 모두 말해 이유가 분명해요. 권역이 셋이 되면 문장을 바꿔야 해요.",
      },
      {
        id: "C",
        text: "이 방은 다른 권역의 역으로 계산하고 있어요. 이 역으로 만나려면 새 방을 만들어 주세요.",
        note: "다음 행동(새 방)을 줘요. 대신 방의 권역이 내 역과 다르다는 사실을 알려 줘서, 숨긴 사람만 남은 옛 방이면 그 권역을 짐작할 수 있어요(ADR-0008).",
      },
    ],
  },
  {
    code: "SCHEDULE_UNAVAILABLE",
    where: "방 결과·미리보기, 직접 추천(지금은 '이 기준으로는 결과를 받지 못했어요…')",
    current: "요청한 시간표를 확인하지 못했습니다",
    variants: [
      {
        id: "A",
        text: "이 요일에는 시간표를 아직 확인하지 못한 역이 있어 계산하지 못했어요. 약속 요일이나 출발역을 바꿔 주세요.",
        note: "서버 응답만으로 쓸 수 있어요(어느 역·노선인지 몰라도 돼요).",
      },
      {
        id: "B",
        text: "토요일 동해선 시간표를 아직 확인하지 못해 계산할 수 없어요. 다른 요일로 바꾸거나 다른 노선 역을 골라 주세요.",
        note: "가장 구체적이에요. 요일·노선을 알려면 웹이 권역별 시간표 범위(regionCoverage)를 받아야 해요. 지금 계약에는 없어요.",
      },
      {
        id: "C",
        text: "이 시간대 시간표를 아직 확인하지 못했어요. 다른 요일로 바꿔 보세요.",
        note: "가장 짧아요. 출발역 때문일 때도 요일 탓처럼 들려요.",
      },
    ],
  },
];

export function ErrorCopySection() {
  return (
    <Section
      n={4}
      title="REGION_MISMATCH·SCHEDULE_UNAVAILABLE 화면 문구"
      question="지금은 방 화면에 서버 문구(합니다체)가 그대로 보여요. errors.ts의 MESSAGES에 넣을 해요체 문구를 골라 주세요."
    >
      {(["A", "B", "C"] as const).map((id) => (
        <Variant
          key={id}
          id={`s4${id}`}
          title={`안 ${id}`}
          summary={
            id === "A"
              ? "권역·노선 이름 없이 이유와 할 일만"
              : id === "B"
                ? "권역·요일·노선을 이름으로"
                : "다음 행동 하나만 짧게"
          }
          pros={ERROR_COPY.map((e) => `${e.code}: ${e.variants.find((v) => v.id === id)?.note ?? ""}`)}
          cons={[]}
        >
          <div className="flex flex-col gap-3">
            {ERROR_COPY.map((e) => {
              const v = e.variants.find((x) => x.id === id);
              return (
                <div key={e.code} className="flex flex-col gap-1">
                  <span className="text-[11px] font-bold text-muted-foreground">{e.code}</span>
                  <div className="flex flex-col gap-1 rounded-2xl border border-rule bg-surface p-3">
                    <p className="text-[14px] font-semibold text-destructive">{v?.text}</p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">지금: {e.current}</span>
                </div>
              );
            })}
          </div>
        </Variant>
      ))}
    </Section>
  );
}

type Gate = "warn" | "block" | "suggest";
const ROOM_DAY: DayType = "saturday";
const SUGGEST_WITHIN_M = 1500;

function dayReason(s: DraftStation, day: DayType): string | null {
  if (!s.unsupportedDays.includes(day)) return null;
  const line = s.lines.join("·");
  return `${DAY_NAME[day]} ${line} 시간표를 아직 확인하지 못해 이 방에서는 고를 수 없어요`;
}

function JoinMock({ gate, style }: { gate: Gate; style: BadgeStyle }) {
  const [query, setQuery] = useState("센텀");
  const [picked, setPicked] = useState<DraftStation | null>(null);
  const rows = searchBoth(query).filter((s) => s.region === "busan");
  const others = [stationNamed("서면", "busan"), stationNamed("남포", "busan")];
  const pickedBad = picked?.unsupportedDays.includes(ROOM_DAY) ?? false;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 rounded-lg bg-surface p-2 text-[13px]">
        <span className="font-bold text-ink">
          방: {DAY_NAME[ROOM_DAY]} 낮 · <RegionTag region="busan" />
        </span>
        <span className="text-ink-soft">들어온 사람: {others.map((o) => o.name).join(", ")}</span>
      </div>
      {picked ? (
        <PickedStation label="내 출발역" station={picked} style={style} onClear={() => setPicked(null)} />
      ) : (
        <div className="flex flex-col gap-1">
          <QueryInput label="내 출발역" value={query} onChange={setQuery} />
          {query.trim() ? (
            <ResultList>
              {rows.map((s) => {
                const reason = gate === "warn" ? null : dayReason(s, ROOM_DAY);
                const near = gate === "suggest" && reason ? nearestAvailable(s, ROOM_DAY, SUGGEST_WITHIN_M) : null;
                return (
                  <StationRow
                    key={s.code}
                    station={s}
                    style={style}
                    tag={false}
                    reason={reason}
                    onPick={() => setPicked(s)}
                    extra={
                      near ? (
                        <button
                          type="button"
                          onClick={() => setPicked(near.station)}
                          className="mb-1 ml-2 rounded-md border border-rule px-2 py-1 text-left text-[12px] font-semibold text-ink"
                        >
                          가까운 {near.station.name}({near.station.lines.join("·")}, 약{" "}
                          {Math.round(near.meters / 100) * 100}m)은 고를 수 있어요
                        </button>
                      ) : null
                    }
                  />
                );
              })}
            </ResultList>
          ) : null}
        </div>
      )}
      {gate === "warn" && pickedBad && picked ? (
        <p className="rounded-lg border border-safety bg-surface p-2 text-[13px] font-semibold text-ink">
          {DAY_NAME[ROOM_DAY]}에는 {picked.lines.join("·")} 시간표를 아직 확인하지 못했어요. 이 역으로 참여하면 방
          결과가 모두에게 안 보여요.
        </p>
      ) : null}
      <button
        type="button"
        disabled={!picked}
        className="min-h-11 rounded-lg bg-ink text-[15px] font-bold text-surface disabled:opacity-40"
      >
        참여하기
      </button>
    </div>
  );
}

export function ScheduleGateSection({ style }: { style: BadgeStyle }) {
  return (
    <Section
      n={5}
      title="그 요일에 출발할 수 없는 역의 참여"
      question="토요일 방에 동해선만 서는 역(예: 센텀)으로 참여하면 방 전체 결과가 409 SCHEDULE_UNAVAILABLE이 돼요. 참여 전에 알릴까요, 막을까요?"
      note={`픽스처 근사: 동해선은 토요일, 부산4호선은 일요일·공휴일 표가 없어요(busan-services.json). 그래서 ${UNSUPPORTED_COUNT.saturday}개 역이 토요일, ${UNSUPPORTED_COUNT.holiday}개 역이 일요일·공휴일에 출발할 수 없어요. 부전(동해선)은 외부 도보로 1호선을 탈 수 있어 빠져요. 실제 목록은 발행 데이터의 regionCoverage.unsupportedOrigins예요.`}
    >
      <Variant
        id="s5a"
        title="안 A · 알리고 참여는 허용"
        summary="역은 고를 수 있고, 고르면 경고 한 줄이 떠요."
        pros={["사람이 요일을 바꿀 계획이면 그대로 들어올 수 있어요", "만들 화면이 가장 적어요"]}
        cons={["한 사람의 선택이 모두의 결과를 막아요", "경고를 못 보고 누르면 방 전체가 고장 난 것처럼 보여요"]}
      >
        <JoinMock gate="warn" style={style} />
      </Variant>
      <Variant
        id="s5b"
        title="안 B · 목록에서 고를 수 없게(권고)"
        summary="지금 '계산하지 않는 역'과 같이 흐리게 두고 요일 이유를 붙여요."
        pros={[
          "방 결과가 깨지는 길을 입력 단계에서 막아요",
          "1번 권역 잠금·#170의 '보이되 못 고름'과 같은 규칙이에요",
          "서버 409는 그대로 두고 안전망으로만 남아요",
        ]}
        cons={[
          "그 역 사람은 다른 역을 직접 찾아야 해요",
          "웹이 요일별 미지원 출발역 목록을 받아야 해요(계약 추가)",
          "방장이 나중에 요일을 바꾸면 이미 들어온 사람은 못 막아요(따로 경고 필요)",
        ]}
      >
        <JoinMock gate="block" style={style} />
      </Variant>
      <Variant
        id="s5c"
        title="안 C · 막고 가까운 역을 제안"
        summary={`B에 더해, 직선 ${SUGGEST_WITHIN_M / 1000}km 안에 그 요일에 출발할 수 있는 역이 있으면 버튼으로 제안해요.`}
        pros={["한 번 눌러 바로 참여할 수 있어요", "센텀 → 센텀시티처럼 걸어갈 만한 역이 흔해요"]}
        cons={[
          "직선거리라 강·고개를 건너는 역을 권할 수 있어요",
          "동해선 북쪽(기장·일광 이북)은 가까운 역이 없어 제안이 비어요",
          "역 좌표를 웹 번들에 더 실어야 해요",
        ]}
      >
        <JoinMock gate="suggest" style={style} />
      </Variant>
    </Section>
  );
}

const SAMPLE: [string, Region][] = [
  ["서면", "busan"],
  ["사상", "busan"],
  ["벡스코", "busan"],
  ["미남", "busan"],
  ["시청", "busan"],
  ["시청", "capital"],
];

function BadgeMock({ style }: { style: BadgeStyle }) {
  const rows = SAMPLE.map(([name, region]) => stationNamed(name, region));
  return (
    <div className="flex flex-col gap-3">
      <ResultList>
        {rows.map((s) => (
          <StationRow key={s.code} station={s} style={style} tag={style === "tagged"} />
        ))}
      </ResultList>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground">펼친 노선 목록</span>
        <BusanLines style={style} />
      </div>
    </div>
  );
}

export function BadgeSection() {
  return (
    <Section
      n={6}
      title="노선 색·배지"
      question="부산 1~4호선을 수도권 1~4호선과 같은 숫자 원으로 그리면, 같은 이름 역(시청 등 13곳)이 섞인 검색에서 헷갈릴 수 있어요."
      note={<ColorSources />}
    >
      <Variant
        id="s6a"
        title="안 A · 숫자 원(노선도 관례)"
        summary="부산 노선도처럼 1~4는 숫자 원, 김해·동해는 이름 알약."
        pros={["부산 노선도·역 안내와 같은 모양이에요", "배지 폭이 가장 좁아요"]}
        cons={[
          "수도권 1호선(남색 1)과 부산 1호선(주황 1)이 색으로만 갈려요",
          "색을 구분하기 어려운 사람에겐 같은 배지예요",
        ]}
      >
        <BadgeMock style="circle" />
      </Variant>
      <Variant
        id="s6b"
        title="안 B · '부산1' 알약"
        summary="부산 노선은 늘 '부산1~4·김해·동해' 글자 알약."
        pros={["색 없이도 권역이 읽혀요", "검색 결과에 권역 꼬리표를 따로 달 필요가 줄어요"]}
        cons={["배지가 넓어 역 이름이 긴 줄(반여농산물시장)은 두 줄이 돼요", "현지 노선도 모양과 달라요"]}
      >
        <BadgeMock style="pill" />
      </Variant>
      <Variant
        id="s6c"
        title="안 C · 숫자 원 + 역 줄 권역 꼬리표"
        summary="배지는 A처럼 두고, 줄 끝에 '부산권'·'수도권' 꼬리표를 달아요."
        pros={["배지는 현지 모양, 권역은 글자로 분명해요", "1번의 같은 이름 역 꼬리표와 같은 부품이에요"]}
        cons={["줄마다 꼬리표가 붙어 목록이 붐벼요", "꼬리표를 늘 달지, 같은 이름일 때만 달지 또 정해야 해요"]}
      >
        <BadgeMock style="tagged" />
      </Variant>
    </Section>
  );
}

function ColorSources() {
  return (
    <span className="flex flex-col gap-1">
      <span>노선색과 출처(운영사 공식 CI의 hex 값은 찾지 못했어요):</span>
      <span className="grid gap-1">
        {BUSAN_LINES.map((l) => (
          <span key={l.label} className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-bold"
              style={{ backgroundColor: l.color, color: badgeInk(l.color) }}
            >
              {l.pill}
            </span>
            <span className="font-mono">{l.color}</span>
            <span>
              {l.label}: {l.source}
              {l.confirmed ? "" : " (확인 필요)"}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
