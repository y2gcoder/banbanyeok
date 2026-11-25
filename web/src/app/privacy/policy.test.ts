import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { RoomPreview } from "@/lib/api/types";
import { INVITE_COPY, ROOM_PREVIEW_LAST_TRAIN, roomShareCopy } from "@/lib/room/share-copy";
import { policyMarkdown } from "./markdown";
import {
  addDays,
  CHANGE_NOTICE,
  CHANGE_NOTICE_DAYS,
  CONTACT_EMAIL,
  HISTORY,
  historyUrl,
  POLICY,
  type Policy,
  PROCESSOR_CONTACT_EMAILS,
  REVISION_DATE,
  UPCOMING_POLICY,
  WITHDRAWN_EFFECTIVE_DATE,
} from "./policy";
import { changeNoticeProblems, koreanDate, upcomingProblems } from "./schedule";
import { FIXTURE_UPCOMING } from "./upcoming.fixture";

const root = resolve(import.meta.dirname, "../../../..");
const legal = resolve(root, "docs/legal");
const mdPath = resolve(legal, "privacy-policy.md");
const historyDir = resolve(legal, "history");
const markdown = policyMarkdown(POLICY, UPCOMING_POLICY, CHANGE_NOTICE);
const textOf = (policy: Policy, id: string) =>
  (policy.sections.find((s) => s.id === id)?.blocks ?? [])
    .flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.rows.flat()))
    .join("\n");
const lineOf = (policy: Policy, id: string, start: string) =>
  textOf(policy, id)
    .split("\n")
    .find((l) => l.startsWith(start)) ?? "";
/** 6항 방 링크 미리보기 항목을 문장으로 나눈 것. 문장마다 한 가지를 적는다. */
const previewSentences = (policy: Policy) =>
  lineOf(policy, "third-party", "방 링크의 미리보기(")
    .split(/(?<=\.)\s+/)
    .filter(Boolean);
/** 그 낱말이 든 문장이 꼭 하나다. */
function one(sentences: readonly string[], word: string): string {
  const found = sentences.filter((s) => s.includes(word));
  expect(found, word).toHaveLength(1);
  return found[0] ?? "";
}

/** 고정한 보존본의 SHA-256. 보존본은 그 판의 기록이라 고치지 않는다. */
const FROZEN_HISTORY: Record<string, string> = {
  [HISTORY.withdrawn.file]: "682d82f24a02f0d11cf0a438a2bbb8307681fac773f6d62ec91919d6a297561e",
};

describe("개인정보 처리방침", () => {
  it("docs/legal/privacy-policy.md가 페이지와 같은 원본에서 나온다", () => {
    if (process.env.UPDATE_PRIVACY_MD) writeFileSync(mdPath, markdown);
    expect(readFileSync(mdPath, "utf8"), "policy.ts를 고쳤다면 UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy").toBe(
      markdown,
    );
  });

  it("보존본(docs/legal/history/)은 그 판의 기록이라 바뀌지 않는다", () => {
    for (const [file, hash] of Object.entries(FROZEN_HISTORY)) {
      const sha = createHash("sha256")
        .update(readFileSync(resolve(historyDir, file)))
        .digest("hex");
      expect(sha, `${file}은 그 판의 기록이라 고치지 않는다`).toBe(hash);
    }
    expect(readdirSync(historyDir).sort()).toEqual(
      Object.values(HISTORY)
        .map((h) => h.file)
        .sort(),
    );
  });

  it("11월 28일 예정 판 보존본은 그 판의 전문이고, 제목 바로 아래 보이는 글로 공지했으나 시행하지 않은 판이라고 밝힌다", () => {
    const text = readFileSync(resolve(historyDir, HISTORY.withdrawn.file), "utf8");
    expect(text.startsWith(`# ${POLICY.title}\n`)).toBe(true);
    // 주석(<!-- -->)은 렌더된 화면에 보이지 않으므로, 표시는 제목 바로 아래 인용문이다.
    const banner = text.split("\n")[2] ?? "";
    expect(banner.startsWith("> **공지했으나 시행하지 않은 판입니다.**")).toBe(true);
    expect(banner).toContain("2026년 11월 28일 시행 예정");
    expect(banner).toContain("시행하지 않았");
    // 대신한 판은 날짜 없이 적는다(이 판의 시행일이 바뀌어도 보존본을 고치지 않게).
    expect(text).not.toMatch(/2026-11-2[2-7] 시행판|11월 2[2-7]일 시행판/);
    expect(text).toContain("이 개인정보 처리방침은 2026년 11월 28일부터 적용됩니다.");
    expect(text).toContain("- 설명 보완·표현 정리: ");
    expect(text).toContain(HISTORY.withdrawn.source);
    expect(text).not.toContain("UPDATE_PRIVACY_MD");
  });

  it("법이 요구하는 항목을 모두 다룬다", () => {
    const titles = POLICY.sections.map((s) => s.title).join("\n");
    for (const topic of [
      "목적",
      "항목",
      "14세",
      "보유",
      "파기",
      "제3자 제공",
      "위탁",
      "국외 이전",
      "권리",
      "안전성",
      "쿠키",
      "자동화된 결정",
      "보호책임자",
      "구제",
      "변경",
      "시행일",
    ]) {
      expect(titles).toContain(topic);
    }
  });

  it("이메일은 운영자 전용 연락 주소와 수탁자의 공식 문의 주소만 쓴다(개인 메일을 넣지 않는다)", () => {
    expect(markdown).toContain(CONTACT_EMAIL);
    let rest = markdown.replaceAll(CONTACT_EMAIL, "");
    for (const email of PROCESSOR_CONTACT_EMAILS) {
      expect(markdown, `허용 목록의 ${email}을 방침이 쓰지 않으면 목록에서 지운다`).toContain(email);
      rest = rest.replaceAll(email, "");
    }
    expect(rest).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it("수탁자 문의 주소 허용 목록에는 회사 주소만 둔다(무료 메일·운영자 도메인 금지)", () => {
    const personalDomains =
      /@(gmail|googlemail|naver|daum|hanmail|kakao|nate|outlook|hotmail|icloud|me|yahoo|proton|protonmail)\./i;
    for (const email of PROCESSOR_CONTACT_EMAILS) {
      expect(email).not.toMatch(personalDomains);
      expect(email.endsWith("@banbanyeok.app")).toBe(false);
    }
  });

  it("시행 중이라 {자리표시}가 하나도 남지 않고, 시행일이 적혀 있다", () => {
    expect(markdown.match(/\{[^{}\n]+\}/g) ?? []).toEqual([]);
    expect(markdown).toContain(`이 개인정보 처리방침은 ${koreanDate(REVISION_DATE, { year: true })}부터 적용됩니다.`);
  });

  it("초안·검토 안내 상자를 싣지 않는다", () => {
    expect(markdown).not.toContain("초안");
    expect(markdown).not.toContain("변호사");
    expect(markdown.startsWith("# ")).toBe(true);
    expect(markdown.split("\n")[2]).not.toMatch(/^>/);
  });

  it("방 링크 미리보기 안내는 정한 역 미리보기가 싣는 약속 시각까지 적는다", () => {
    const shown = roomShareCopy({
      stage: "decided",
      room: {
        roomId: "qt7yvmsht3",
        shareVersion: 4,
        participantCount: 2,
        canJoin: false,
        meetingDate: "2026-11-21",
        meetingTime: "19:30",
        meetingBand: null,
        timeBasis: {
          timeSlot: "saturday-evening",
          requestedTimeSlot: "saturday-evening",
          label: "토요일 저녁",
          dayType: "saturday",
          band: "evening",
          holidayName: null,
        },
      },
      dataVersion: "20261115.8",
      basis: { mode: "fair", favorLabel: null },
      station: { stationCode: "k3a", stationName: "강남", times: [{ label: "민수", seconds: 600 }] },
      decidedBy: "민수",
      decidedAt: "2026-11-17T10:00:00Z",
    }).preview.description;
    expect(shown).toContain("19:30");
    const line = markdown.split("\n").find((l) => l.includes("방 링크의 미리보기("));
    expect(line).toContain("약속 날짜·시각");
  });

  it("방 미리보기 그림의 막차 줄은 6항의 미리보기 안내에 막차를 적은 뒤에만 켠다", () => {
    // 6항은 방 링크 미리보기에 보이는 것을 적는다. 적지 않은 것(귀갓길 막차 시각)을 그림에 먼저 싣지 않는다. 문장마다 본다.
    const sentences = previewSentences(POLICY);
    expect(
      !ROOM_PREVIEW_LAST_TRAIN || sentences.some((s) => s.includes("미리보기 그림") && s.includes("막차")),
      "ROOM_PREVIEW_LAST_TRAIN을 켜려면 6항의 방 링크 미리보기 안내에 그림의 귀갓길 막차 시각 문장을 먼저 적으세요.",
    ).toBe(true);
    expect(ROOM_PREVIEW_LAST_TRAIN).toBe(true);
  });

  it("6항 방 링크 미리보기: 범위(누구에게나 보이는 정보와 그것으로 계산한 값, 숨긴 사람은 빼고)를 먼저 적고 항목은 문장마다 하나", () => {
    const sentences = previewSentences(POLICY);
    expect(sentences[0]).toContain("메신저가 그 링크의 미리보기를 처음 가져갈 때의 방 상태");
    expect(sentences[0]).toContain(
      "방 링크를 가진 사람 누구에게나 방 화면에서 보이는 정보와 그 정보로 계산한 값의 일부",
    );
    expect(sentences[1]).toBe(
      "출발역을 숨긴 사람의 출발역과 귀갓길 막차 시각은 넣지 않고, 소요시간은 5분 단위로 올린 값(0분도 5분)을 넣습니다.",
    );
    const shown = one(sentences, "지금 미리보기에 보이는 것");
    expect(shown).toContain("1위 역이나 방에서 정한 역, 참여자별 이름과 소요시간");
    expect(shown).toContain("누구를 배려하는 방이면 그 사람의 이름");
    // #162: 숨긴 사람 쪽 배려는 남의 미리보기에 나오지 않는다(서버가 공평하게로 계산한다).
    expect(shown).toContain("배려하는 사람이 출발역을 숨긴 사람이면 그 이름 대신 '공평하게'");
    expect(shown).toContain("정한 사람과 약속 날짜·시각·시간대");
    expect(one(sentences, "모으는 중이면")).toContain("방의 내용이 없는 초대 문구와 기본 그림");
    expect(one(sentences, "요약")).toContain("가장 오래 걸리는 시간과 시간 차이");
    // 그림의 막차 줄은 확인할 수 있고 약속 이후에 탈 수 있을 때만 그린다(약속보다 먼저 떠나거나 '확인 필요'면 줄이 없다).
    expect(one(sentences, "작은 줄")).toBe(
      "출발역을 공개한 참여자의 귀갓길 막차 중 확인할 수 있고 약속 이후에 탈 수 있는 막차는 그 시각 또는 여유 시각을 미리보기 그림에 작은 줄로 표시할 수 있습니다.",
    );
    const middle = one(sentences, "견준 문장");
    expect(middle).toContain("모두가 갈 수 있는 만남 후보 중 출발역들의 가운데에 가장 가까운 역");
    expect(middle).toContain("미리보기 그림과 글, 카카오톡 공유 메시지, 기기 공유 창으로 보내는 본문");
    expect(middle).toContain("출발역을 숨긴 사람이 있으면 넣지 않습니다");
    expect(one(sentences, "링크를 보낸 뒤")).toContain("메신저가 처음 가져갈 때의 바뀐 상태로 만듭니다");
    expect(one(sentences, "이름을 입력한 사람은")).toBe(
      "이름을 입력한 사람은 그 이름이, 이름 없이 출발역을 공개한 사람은 출발역 이름이 보이고, 이름 없이 출발역을 숨긴 사람은 '참가자 N'으로 보입니다.",
    );
    expect(one(sentences, "그림 글꼴")).toContain("긴 이름은 줄이며, 남는 글자가 없으면 '참가자 N'");
    // '보내는 때'(실제와 다른 옛 안내)와 '지도상 가운데'(실제 선택 범위보다 넓음)는 어디에도 남지 않는다.
    expect(textOf(POLICY, "third-party")).not.toContain("보내는 때");
    expect(textOf(POLICY, "third-party")).not.toContain("지도상 가운데");
    expect(markdown.split("## 최근 중요한 변경")[0]).not.toContain("보내는 때");
  });

  it("6항 미리보기 응답: 계약(openapi)의 모으는 중·결과·정한 역 응답의 키가 중첩까지 빠짐없이 6항과 비교표에 있다", () => {
    type Schema = {
      $ref?: string;
      properties?: Record<string, Schema>;
      items?: Schema;
      oneOf?: Schema[];
      anyOf?: Schema[];
      allOf?: Schema[];
    };
    const doc = parse(readFileSync(resolve(root, "contracts/openapi.yaml"), "utf8")) as {
      components: { schemas: Record<string, Schema> };
    };
    const deref = (schema: Schema | undefined): Schema | undefined =>
      schema?.$ref ? deref(doc.components.schemas[schema.$ref.split("/").pop() ?? ""]) : schema;
    /** 스키마의 키를 "station.times[].lastTrain.kind"처럼 점으로 이은 경로로 모은다($ref·oneOf·배열 안까지). */
    const paths = (schema: Schema | undefined, prefix: string, out: Set<string>) => {
      const s = deref(schema);
      if (!s) return out;
      for (const alt of [...(s.oneOf ?? []), ...(s.anyOf ?? []), ...(s.allOf ?? [])]) paths(alt, prefix, out);
      if (s.items) paths(s.items, `${prefix}[]`, out);
      for (const [key, value] of Object.entries(s.properties ?? {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        out.add(path);
        paths(value, path, out);
      }
      return out;
    };
    const all = new Set<string>();
    for (const stage of ["RoomPreviewCollecting", "RoomPreviewResult", "RoomPreviewDecided"]) {
      paths({ $ref: `#/components/schemas/${stage}` }, "", all);
    }
    // 값이 있는 끝 키만 센다(room, station처럼 다른 키를 담는 키는 그 안의 키로 센다).
    const leaves = [...all].filter(
      (path) => ![...all].some((other) => other.startsWith(`${path}.`) || other.startsWith(`${path}[]`)),
    );
    // 미리보기 응답의 끝 키마다 6항이 그것을 적는 말. 계약에 키가 늘면 이 표와 6항을 함께 고친다(표에 없으면 실패).
    const described: Record<string, string> = {
      stage: "방 단계(모으는 중·결과·정한 역)",
      "room.roomId": "방 ID와 공유 번호",
      "room.shareVersion": "방 ID와 공유 번호",
      "room.participantCount": "참여 인원",
      "room.canJoin": "지금 새로 참여할 수 있는지",
      "room.meetingDate": "약속 날짜·시각·시간대",
      "room.meetingTime": "약속 날짜·시각·시간대",
      "room.meetingBand": "약속 날짜·시각·시간대",
      "room.timeBasis.timeSlot": "요청한 구분과 실제로 쓴 구분",
      "room.timeBasis.requestedTimeSlot": "요청한 구분과 실제로 쓴 구분",
      "room.timeBasis.label": "그것으로 정한 계산 기준",
      "room.timeBasis.dayType": "계산 기준(요일 종류",
      "room.timeBasis.band": "요일 종류·시간대",
      "room.timeBasis.holidayName": "공휴일 이름",
      dataVersion: "계산에 쓴 데이터 버전",
      "basis.mode": "추천 기준과 배려 대상의 이름",
      "basis.favorLabel": "추천 기준과 배려 대상의 이름",
      "station.stationCode": "1위 역이나 정한 역의 역 코드와 이름",
      "station.stationName": "1위 역이나 정한 역의 역 코드와 이름",
      "station.times[].label": "참여자별 이름과 소요시간",
      "station.times[].seconds": "참여자별 이름과 소요시간",
      "station.times[].lastTrain.kind": "막차의 종류(직행 확정·여유 시각·확인 필요)",
      "station.times[].lastTrain.minute": "만날 역에서 타는 시각(분)",
      "station.times[].lastTrain.transfer": "갈아타는 길인지",
      "station.times[].lastTrain.boundFor.stationCode": "그 열차의 행선지 역 코드와 이름",
      "station.times[].lastTrain.boundFor.stationName": "그 열차의 행선지 역 코드와 이름",
      "lastTrainBasis.dayType": "막차 자료의 기준(요일 종류",
      "lastTrainBasis.asOf": "시간표 기준일",
      "lastTrainBasis.unavailable": "시각을 낼 수 없는 이유",
      "lastTrainBasis.partial": "일부 노선만 안내하는지",
      decidedBy: "정한 사람과 정한 시각",
      decidedAt: "정한 사람과 정한 시각",
      // 이 판에 더한 키.
      "mapMiddle.stationCode": "지도 한가운데 역의 역 코드·이름",
      "mapMiddle.stationName": "지도 한가운데 역의 역 코드·이름",
      "mapMiddle.times[].label": "그 역까지 참여자별 소요시간",
      "mapMiddle.times[].seconds": "그 역까지 참여자별 소요시간",
      lastTrainPending: "막차 표 준비 중 표시",
    };
    expect(leaves.sort()).toEqual(Object.keys(described).sort());
    const sentences = previewSentences(POLICY);
    const api = one(sentences, "서버 응답");
    expect(api).toContain("방 ID만 있으면 누구나 받을 수 있으며");
    const preview = sentences.join(" ");
    for (const [key, phrase] of Object.entries(described)) expect(preview, key).toContain(phrase);
    expect(one(sentences, "막차 표 준비 중 표시")).toContain("서버의 상태이고 참여자의 정보가 아닙니다");
    // 이 판 전부터 응답에 있던 키는 비교표의 '바뀌기 전'에도 적는다(이 판에 더한 키는 '바뀐 후').
    const row = CHANGE_NOTICE?.rows.find((r) => r.item.includes("방 미리보기 응답"));
    for (const [key, phrase] of Object.entries(described)) {
      const added = key.startsWith("mapMiddle.") || key === "lastTrainPending";
      expect(added ? row?.after : row?.before, key).toContain(phrase);
      if (added) expect(row?.before, key).not.toContain(phrase);
    }
  });

  it("6항 미리보기: 배려 방은 배려 대상을, 정한 방은 정한 사람과 약속 시각을 그림과 글에 싣고, 모으는 중은 초대 문구다", () => {
    const room = {
      roomId: "qt7yvmsht3",
      shareVersion: 4,
      participantCount: 2,
      canJoin: true,
      meetingDate: "2026-11-27",
      meetingTime: "19:30",
      meetingBand: null,
      timeBasis: {
        timeSlot: "weekday-evening",
        requestedTimeSlot: "weekday-evening",
        label: "평일 저녁",
        dayType: "weekday",
        band: "evening",
        holidayName: null,
      },
    } satisfies RoomPreview["room"];
    const station = {
      stationCode: "s1c",
      stationName: "시청",
      times: [
        { label: "민수", seconds: 1200 },
        { label: "수진", seconds: 900 },
      ],
    };
    const sentences = previewSentences(POLICY);
    // 배려 방: 배려 대상의 이름이 제목·그림의 기준 줄에 나간다(그 사람이 출발역을 숨겼어도 이름표는 나간다).
    const favor = roomShareCopy({
      stage: "result",
      room,
      dataVersion: "20261120.5",
      basis: { mode: "favor", favorLabel: "수진" },
      station,
    });
    expect(favor.preview.title).toContain("수진 쪽으로");
    expect(favor.message.title).toBe(favor.preview.title);
    expect(favor.card?.modeLine).toContain("수진 쪽으로 고름");
    expect(one(sentences, "지금 미리보기에 보이는 것")).toContain("그림의 '○○ 쪽으로 고름'과 제목의 '○○ 쪽으로'");
    // 정한 방: 그림과 글에는 정한 사람과 약속 시각이 나가고, 정한 시각(decidedAt)은 응답에만 있다.
    const decided = roomShareCopy({
      stage: "decided",
      room: { ...room, canJoin: false },
      dataVersion: "20261120.5",
      basis: { mode: "fair", favorLabel: null },
      station,
      decidedBy: "민수",
      decidedAt: "2026-11-21T03:40:19Z",
    });
    expect(decided.preview.description).toContain("민수");
    expect(decided.preview.description).toContain("19:30");
    expect(decided.message.text).toBe(decided.preview.description);
    expect(JSON.stringify(decided)).not.toContain("03:40");
    expect(JSON.stringify(decided)).not.toContain("12:40");
    expect(one(sentences, "서버 응답")).toContain("정한 사람과 정한 시각");
    // 모으는 중: 방의 내용이 없는 초대 문구와 기본 그림. 공유 창 본문도 초대 문구다(미리보기 글과는 말이 조금 다르다).
    const collecting = roomShareCopy({ stage: "collecting", room });
    expect(collecting).toBe(INVITE_COPY);
    expect(collecting.card).toBeNull();
    expect(JSON.stringify(collecting)).not.toContain(room.roomId);
    expect(lineOf(POLICY, "third-party", "카카오톡 공유를 쓸 수 없을 때")).toContain(
      "아직 모으는 중이면 초대 문구입니다",
    );
  });

  it("6항: 기기 공유 창(시스템 공유 시트)으로 넘기는 제목·본문·링크와, 그 본문이 미리보기 글과 같다는 것을 적는다", () => {
    const share = lineOf(POLICY, "third-party", "카카오톡 공유를 쓸 수 없을 때");
    expect(share).toContain("기기의 공유 창(시스템 공유 시트)을 열어 제목과 본문, 링크 주소를 넘기고");
    expect(share).toContain("방 링크의 본문은 결과와 정한 역 단계에서는 아래 미리보기 글과 같고");
    expect(share).toContain("지도 한가운데 비교 문장이 붙을 수 있습니다");
    // 공유 창이 없으면 복사 대화상자에 제목·본문·주소가 보이고(외부 전송 없음), 복사는 주소 하나다(share-actions.tsx).
    expect(share).toContain("공유 창을 열 수 없으면 같은 제목과 본문, 링크 주소를 화면의 대화상자에 보여 주며");
    expect(share).toContain("'링크 복사'는 링크 주소 하나만 복사합니다");
    expect(share).not.toContain("링크 주소만 보여 주고");
    // 메신저가 읽는 링크 주소: 출발역·이름이 담기는 것은 혼자 입력한 링크뿐이다(방 링크는 /r/<방 ID>?sv=).
    const messenger = lineOf(POLICY, "third-party", "카카오톡 같은 메신저로");
    expect(messenger).toContain("링크 주소(혼자 입력한 결과의 링크는 출발역·이름 포함)");
    // 코드: 방의 공유 시트 본문은 미리보기 글(og:description)과 같다.
    const preview: RoomPreview = {
      stage: "result",
      dataVersion: "20261115.8",
      basis: { mode: "fair", favorLabel: null },
      station: {
        stationCode: "s2b",
        stationName: "신당",
        times: [
          { label: "방장", seconds: 1320 },
          { label: "잠실", seconds: 1260 },
        ],
      },
      mapMiddle: {
        stationCode: "j7v",
        stationName: "한강진",
        times: [
          { label: "방장", seconds: 1412 },
          { label: "잠실", seconds: 2159 },
        ],
      },
      room: {
        roomId: "qt7yvmsht3",
        shareVersion: 4,
        participantCount: 2,
        canJoin: true,
        meetingDate: null,
        meetingTime: null,
        meetingBand: null,
        timeBasis: {
          timeSlot: "weekday-day",
          requestedTimeSlot: "weekday-day",
          label: "평일 낮",
          dayType: "weekday",
          band: "day",
          holidayName: null,
        },
      },
    };
    const copy = roomShareCopy(preview);
    expect(copy.message.text).toBe(copy.preview.description);
    expect(copy.message.text).toContain("지도 한가운데인 한강진역이면");
  });

  it("6항 이미 제공하던 기능: 방 화면의 막차, 숨긴 사람은 본인만, 막차 확인 버튼, 혼자 입력한 링크", () => {
    const room = lineOf(POLICY, "third-party", "방 링크를 가진 사람은");
    expect(room).toContain("출발역을 공개한 사람의 귀갓길 막차 시각을 볼 수 있습니다");
    expect(room).toContain(
      "출발역을 숨긴 사람은 출발역 대신 5분 단위로 올린 소요시간만 보이고, 막차 시각은 본인만 봅니다",
    );
    const hidden = lineOf(POLICY, "third-party", "출발역을 숨기면");
    expect(hidden).toContain("귀갓길 막차 시각은 그 사람 본인의 화면에만 보이며");
    const map = lineOf(POLICY, "third-party", "길찾기 버튼이나");
    expect(map).toContain("'지도 앱에서 막차 확인하기'");
    expect(map).toContain("이 길찾기 정보는 버튼을 누를 때 보냅니다");
    expect(map).not.toContain("아무것도 전달하지 않습니다");
    // 혼자 입력한 링크에는 숨기기가 없다: 방의 숨김 규칙이 있는 것처럼 쓰지 않는다.
    const solo = lineOf(POLICY, "third-party", "혼자 입력한 결과의 링크 주소에는");
    expect(solo).toContain("입력한 출발역과 이름이 그대로 담기며, 혼자 입력할 때는 출발역을 숨기는 기능이 없습니다");
    expect(solo).toContain("시간대를 골랐으며 계산할 수 있을 때는 사람별 귀갓길 막차 시각도 보입니다");
    expect(solo).toContain("만남 후보 중 출발역들의 가운데에 가장 가까운 역");
    expect(solo).not.toContain("숨긴 사람");
  });

  it('공개 문서에 "AI"라는 표현을 쓰지 않는다', () => {
    expect(markdown).not.toMatch(/\bAI\b|인공지능/);
  });

  it("카카오톡 공유: 모든 공유 버튼 이름으로, 공유 칸이 보일 때 카카오로 가는 것과 누를 때만 메시지 내용이 간다는 것을 적는다", () => {
    const line = markdown.split("\n").find((l) => l.includes("카카오 JavaScript SDK")) ?? "";
    const base: Omit<Extract<RoomPreview, { stage: "result" }>, "stage"> = {
      dataVersion: "20261115.8",
      basis: { mode: "fair", favorLabel: null },
      station: { stationCode: "k3a", stationName: "강남", times: [{ label: "민수", seconds: 600 }] },
      room: {
        roomId: "qt7yvmsht3",
        shareVersion: 4,
        participantCount: 2,
        canJoin: true,
        meetingDate: null,
        meetingTime: null,
        meetingBand: null,
        timeBasis: {
          timeSlot: "weekday-day",
          requestedTimeSlot: "weekday-day",
          label: "평일 낮",
          dayType: "weekday",
          band: "day",
          holidayName: null,
        },
      },
    };
    const buttons = [
      INVITE_COPY.message.button,
      roomShareCopy({ stage: "result", ...base }).message.button,
      roomShareCopy({ stage: "decided", ...base, decidedBy: "민수", decidedAt: "2026-11-17T10:00:00Z" }).message.button,
    ];
    for (const button of buttons) expect(line, button).toContain(`'${button}'`);
    expect(line).toContain("카카오 주식회사");
    expect(line).toContain("접속 IP 주소");
    expect(line).toContain("공유 칸이 화면에 보이면");
    expect(line).toContain("이용자나 방의 내용이 없는 고정된 확인 메시지");
    expect(line).toContain("이 버튼을 누를 때에만 카카오로 보냅니다");
    expect(line).toContain("공유 칸이 화면에 보이기 전에는 카카오 공유 프로그램을 받지 않으며");
  });

  it("'예정된 변경' 절은 예정된 다음 판이 있을 때만 md에 있다", () => {
    expect(markdown.includes("## 예정된 변경")).toBe(UPCOMING_POLICY !== null);
    expect(policyMarkdown(POLICY)).not.toContain("예정된 변경");
  });

  it("예정 판이 있으면 지금 판 뒤에 '예정된 변경' 절만 붙고 오늘 날짜와 무관하다", () => {
    const base = policyMarkdown(POLICY);
    const withUpcoming = policyMarkdown(POLICY, FIXTURE_UPCOMING);
    expect(withUpcoming.startsWith(base)).toBe(true);
    const added = withUpcoming.slice(base.length);
    expect(added).toContain("## 예정된 변경");
    expect(added).toContain("시행일: 2026년 12월 20일");
    expect(added).toContain("공지 시작일: 2026년 12월 1일");
    expect(added).toContain(FIXTURE_UPCOMING.summary);
    expect(added).toContain("| 방 정보 보관 기간 (4항) | 마지막 변경 후 7일 | 마지막 변경 후 14일 |");
    expect(withUpcoming).not.toContain(FIXTURE_UPCOMING.policy.title);
  });

  it("15항: 바로 시행하고, 중요한 변경만 시행일부터 정한 기간 화면에 알리며, 이용 통계 변경은 다시 동의를 받는다", () => {
    const rules = textOf(POLICY, "changes")
      .split("\n")
      .filter((l) => /^(처리방침을 바꾸면|수집하는 정보|동의를 받아)/.test(l));
    expect(rules).toHaveLength(3);
    expect(rules[0]).toBe(
      "처리방침을 바꾸면 바로 시행하고, 아래 변경 이력에 날짜와 요지를 적고 이전 판의 링크를 남깁니다.",
    );
    expect(rules[1]).toContain("수집하는 정보, 다른 사람에게 보이는 범위, 외부로 보내는 정보가 바뀌는 중요한 변경은");
    expect(rules[1]).toContain(`시행일부터 ${CHANGE_NOTICE_DAYS}일 동안 서비스 첫 화면과 이 처리방침 맨 위에`);
    // CONSENT_VERSION을 올리면 낡은 기록이 무효가 되어 다시 동의할 때까지 통계를 켜지 않는다(lib/analytics/consent.ts).
    expect(rules[2]).toContain("동의를 다시 받습니다. 다시 동의하기 전에는 이용 통계를 모으지 않습니다.");
    const text = textOf(POLICY, "changes");
    expect(text).not.toContain("시행 7일 전부터 서비스 화면에 알리고");
    expect(text).not.toContain("설명 보완·표현 정리: ");
  });

  it("15항 변경 이력: 7일 전 알림 없이 바로 시행했다는 것과 그 이유, 11월 28일 예정 판을 시행하지 않는다는 것을 정직하게 적는다", () => {
    const text = textOf(POLICY, "changes");
    const day = koreanDate(REVISION_DATE, { year: true });
    // 이 판(#162): 같은 날 두 번째로 고친 판이라 11월 17일의 예처럼 '개정판'이다.
    expect(REVISION_DATE).toBe("2026-11-24");
    const mine = lineOf(POLICY, "changes", `변경 이력: ${day} 개정판은`);
    expect(mine).toContain("숨긴 사람 쪽으로 맞춘 결과는 그 사람 본인의 화면에만 보이고");
    expect(mine).toContain(
      "다른 사람에게는 '공평하게'로 보이며 미리보기·공유 문구에도 그 사람의 이름을 배려 대상으로 넣지 않습니다",
    );
    expect(mine).toContain("처리방침은 미리보기에 '배려하는 사람의 이름'이 보인다고만 적었습니다");
    expect(mine).toContain("다른 사람에게 보이는 범위가 바뀌는 중요한 변경이라 화면에 알립니다");
    expect(mine).toContain("2026년 11월 24일 시행판은 같은 날 이 판을 시행하기 전까지 적용했습니다");
    expect(mine).toContain("수집하는 정보, 처리 목적, 보유 기간, 처리 위탁과 국외 이전, 이용 통계는 바뀌지 않았습니다");
    const hidden = lineOf(POLICY, "third-party", "출발역을 숨기면");
    expect(hidden).toContain("출발역을 숨긴 사람 쪽으로 맞춘 결과도 그 사람 본인의 화면에만 보이고");
    expect(hidden).toContain("다른 사람 쪽으로 맞춘 결과의 후보는 숨긴 사람의 시간으로 거르지 않습니다");
    const nov24 = lineOf(POLICY, "changes", "변경 이력: 2026년 11월 24일 시행판은");
    // 11월 24일 시행판(#142): 숨긴 사람의 시간을 5분 단위로 뭉뚱그리고, 그래도 출발역을 짐작할 수 있다는 사실을 적는다.
    const mineNov24 = nov24;
    expect(mineNov24).toContain(
      "0분으로 보여 출발역이 드러날 수 있었는데, 처리방침은 '출발 지역을 대략 짐작할 수 있다'고만 적었습니다",
    );
    expect(mineNov24).toContain("5분 단위로 올린 값(0분도 5분)으로만 보이고 환승 횟수는 보이지 않으며");
    expect(mineNov24).toContain("공개된 노선 자료와 맞춰 보면 알아낼 수도 있다");
    expect(mineNov24).toContain("다른 사람에게 보이는 범위가 바뀌는 중요한 변경이라 화면에 알립니다");
    const nov21 = lineOf(POLICY, "changes", "변경 이력: 2026년 11월 21일 시행판은");
    expect(nov21).toContain(
      "직전 판(2026년 11월 17일 세 번째 개정판)의 15항이 약속한 '시행 7일 전 알림' 없이 바로 시행했습니다",
    );
    expect(nov21).toContain("운영자 개인이 수익 없이 운영하는 서비스");
    expect(nov21).toContain("회원가입도, 새로 받는 개인정보 항목도, 정보를 새로 보내는 곳도 없어서");
    expect(nov21).toContain("다른 사람에게 보이는 범위가 넓어지는 중요한 변경이라 화면에 알립니다");
    const withdrawn = lineOf(POLICY, "changes", "변경 이력: 2026년 11월 21일부터");
    expect(withdrawn).toContain(`${koreanDate(WITHDRAWN_EFFECTIVE_DATE, { year: true })} 시행 예정 판`);
    expect(withdrawn).toContain("시행하지 않고 2026년 11월 21일 시행판으로 대신합니다");
    expect(text).toContain("같은 날 세 번 고쳤습니다");
  });

  it("15항 이전 판: 판 이름이 모두 그 판의 전문으로 잇는 링크이고, 한 줄에 하나다(11월 28일 예정 판은 시행하지 않았다고 표기)", () => {
    const text = textOf(POLICY, "changes");
    const links = [...text.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)].map(([, label = "", url = ""]) => ({
      label,
      url,
    }));
    for (const commit of ["57a068a", "267cda0", "bd083b5", "ecd3a47", "44631a9", "5b0e704"]) {
      expect(links.map((l) => l.url)).toContain(
        `https://github.com/y2gcoder/banbanyeok/blob/${commit}/docs/legal/privacy-policy.md`,
      );
    }
    expect(links).toContainEqual({
      label: "2026년 11월 28일 시행 예정 판(시행하지 않음)",
      url: historyUrl(HISTORY.withdrawn.file),
    });
    for (const { url } of links.filter((l) => l.url.includes("/blob/main/"))) {
      expect(existsSync(resolve(legal, url.split("/docs/legal/")[1] ?? "")), url).toBe(true);
    }
    const versions = text.split("\n").filter((l) => l.startsWith("["));
    expect(versions).toHaveLength(7);
    expect(versions.map((l) => [...l.matchAll(/\]\(https:/g)].length)).toEqual(versions.map(() => 1));
    expect(text).toContain(
      "세 번째 개정판](https://github.com/y2gcoder/banbanyeok/blob/ecd3a47/docs/legal/privacy-policy.md): 2026년 11월 17일부터 2026년 11월 21일 시행판 시행 전까지 적용했습니다.",
    );
    expect(text).toContain(
      "11월 21일 시행판](https://github.com/y2gcoder/banbanyeok/blob/44631a9/docs/legal/privacy-policy.md): 2026년 11월 21일부터 2026년 11월 24일 시행판 시행 전까지 적용했습니다.",
    );
    expect(text).toContain(
      "11월 24일 시행판](https://github.com/y2gcoder/banbanyeok/blob/5b0e704/docs/legal/privacy-policy.md): 2026년 11월 24일 하루, 이 판 시행 전까지 적용했습니다.",
    );
    expect(text).toContain("2026년 11월 21일부터 알렸으나 시행하지 않았습니다.");
  });

  it("날짜: 이 판의 시행일은 REVISION_DATE 하나이고, 11월 28일 예정 판이 시행되기 전이다", () => {
    expect(REVISION_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${REVISION_DATE}T00:00:00Z`).toISOString().slice(0, 10)).toBe(REVISION_DATE);
    // main의 예정 판(11-28 시행)이 시행된 뒤라면 '시행하지 않았다'는 이력이 틀린다. 그때는 이력을 고쳐 쓴다.
    // 하한은 이 판을 정하고 배포하는 날(2026-11-21)이다.
    expect(REVISION_DATE >= "2026-11-21" && REVISION_DATE < WITHDRAWN_EFFECTIVE_DATE).toBe(true);
    expect(textOf(POLICY, "changes").split("\n")[0]).toBe(
      `이 개인정보 처리방침은 ${koreanDate(REVISION_DATE, { year: true })}부터 적용됩니다.`,
    );
    expect(addDays("2026-11-22", 6)).toBe("2026-11-28");
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });

  it("중요한 변경 안내(CHANGE_NOTICE): 이 판은 보이는 범위가 바뀌어 켜고, 시행일부터 15항의 일수만큼이며 전후 비교가 빠짐없다", () => {
    expect(CHANGE_NOTICE).not.toBeNull();
    expect(changeNoticeProblems(CHANGE_NOTICE, CHANGE_NOTICE_DAYS)).toEqual([]);
    expect(CHANGE_NOTICE?.since).toBe(REVISION_DATE);
    // 직전 판은 같은 날 앞서 시행한 11월 24일 시행판(#142)이다.
    expect(CHANGE_NOTICE?.previous.url).toBe(
      "https://github.com/y2gcoder/banbanyeok/blob/5b0e704/docs/legal/privacy-policy.md",
    );
    expect(CHANGE_NOTICE?.previous.label).toBe("2026년 11월 24일 시행판");
    const rows = CHANGE_NOTICE?.rows ?? [];
    // 이 판의 행(#162)이 맨 앞이다. 보이는 범위가 줄어도 중요한 변경으로 알린다(15항에 '축소면 생략' 예외가 없다).
    expect(rows[0]?.item).toBe("출발역을 숨긴 사람 쪽으로 맞춘 '누구 쪽으로' 결과 (6항)");
    expect(rows[0]?.before).toContain(
      "링크 미리보기(응답·그림·글), 공유 문구에 그 결과와 그 사람의 이름(배려 대상)이 나감",
    );
    expect(rows[0]?.after).toContain("그 사람 본인의 화면에만 보임");
    expect(rows[0]?.after).toContain("'공평하게'로 보이고 그 사람의 이름을 배려 대상으로 넣지 않음");
    expect(rows[1]?.item).toBe("다른 사람 쪽으로 맞춘 '누구 쪽으로' 결과의 후보 (6항)");
    // 같은 날 앞선 판(11-24, #142)의 행. 미리보기 응답(PreviewTime)에는 환승이 없으므로 소요시간과 환승의 노출 범위를 나눠 적는다.
    const nov24 = rows[2];
    expect(nov24?.item).toBe("[11월 24일 시행판] 출발역을 숨긴 사람의 소요시간과 환승 횟수 (6항)");
    expect(nov24?.before).toContain(
      "정확한 소요시간이 다른 사람의 방 화면과 링크 미리보기(응답·그림·글), 공유 문구에 보이고",
    );
    expect(nov24?.before).toContain(
      "환승 횟수가 다른 사람의 방 화면에 보임(미리보기와 공유 문구에는 환승 횟수가 원래 없음)",
    );
    expect(nov24?.after).toContain("5분 단위로 올린 소요시간(0분도 5분)만 보이고 환승 횟수는 보이지 않음");
    expect(nov24?.after).toContain("출발역을 짐작할 수 있고");
    // 앞선 두 판의 안내 기간(11-30·11-27까지)이 남아 그 판들의 행도 머리말을 붙여 함께 싣는다(15항의 7일 약속을 끊지 않는다).
    expect(addDays("2026-11-24", CHANGE_NOTICE_DAYS - 1) >= REVISION_DATE).toBe(true);
    expect(addDays("2026-11-21", CHANGE_NOTICE_DAYS - 1) >= REVISION_DATE).toBe(true);
    expect(CHANGE_NOTICE?.since).toBe("2026-11-24");
    // 이 안내는 앞선 판의 기간 뒤에도(시행일부터 7일) 보이므로 그 기간을 요약에 적지 않는다.
    expect(CHANGE_NOTICE?.summary).toContain(
      "표 뒷부분에는 앞선 판(2026년 11월 24일 시행판, 2026년 11월 21일 시행판)에서 바뀐 내용도 함께 적었습니다.",
    );
    expect(CHANGE_NOTICE?.summary).not.toMatch(/\d+일까지/);
    expect(rows.slice(3).every((r) => r.item.startsWith("[11월 21일 시행판] "))).toBe(true);
    const row = (item: string) => rows.find((r) => r.item.startsWith(`[11월 21일 시행판] ${item}`));
    expect(row("방 미리보기 응답")?.after).toContain("역 코드·이름과 그 역까지 참여자별 소요시간");
    expect(row("방 미리보기 응답")?.after).toContain("막차 표 준비 중 표시");
    expect(row("메신저 미리보기 그림")?.after).toContain("약속 이후에 탈 수 있는 막차의 시각 또는 여유 시각");
    expect(row("메신저 미리보기 글")?.item).toContain("기기 공유 창으로 보내는 본문");
    expect(row("미리보기에 보이는 방 상태")?.after).toContain("메신저가 그 링크의 미리보기를 처음 가져갈 때");
    expect(row("2026년 11월 28일 시행 예정 판")?.after).toBe("시행하지 않고 11월 21일 시행판으로 대신함");
    expect(row("처리방침을 바꿀 때")?.after).toContain("바로 시행");
  });

  it("md 끝의 '최근 중요한 변경' 절은 안내가 있을 때만 붙고 오늘 날짜와 무관하다", () => {
    expect(markdown.includes("## 최근 중요한 변경")).toBe(CHANGE_NOTICE !== null);
    expect(policyMarkdown(POLICY)).not.toContain("최근 중요한 변경");
    if (CHANGE_NOTICE) {
      const added = markdown.slice(markdown.indexOf("## 최근 중요한 변경"));
      expect(added).toContain(`- 시행일: ${koreanDate(CHANGE_NOTICE.since, { year: true })}`);
      expect(added).toContain(CHANGE_NOTICE.summary);
    }
  });

  it("예정 판 장치는 쓰지 않는다(15항이 미리 알리기를 요구하지 않음)", () => {
    expect(UPCOMING_POLICY).toBeNull();
    expect(upcomingProblems(UPCOMING_POLICY)).toEqual([]);
  });

  it("목차 앵커가 겹치지 않는다", () => {
    const ids = POLICY.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
