import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RoomPreview } from "@/lib/api/types";
import { INVITE_COPY, ROOM_PREVIEW_LAST_TRAIN, roomShareCopy } from "@/lib/room/share-copy";
import { policyMarkdown } from "./markdown";
import {
  addDays,
  CONTACT_EMAIL,
  HISTORY,
  historyUrl,
  POLICY,
  type Policy,
  PREVIEW_EFFECTIVE_DATE,
  PROCESSOR_CONTACT_EMAILS,
  REVISION_DATE,
  THREE_STEP_RULE_DATE,
  threeStepRulePeriod,
  UPCOMING_POLICY,
} from "./policy";
import { koreanDate, MIN_NOTICE_DAYS, upcomingProblems } from "./schedule";
import { FIXTURE_UPCOMING } from "./upcoming.fixture";

const legal = resolve(import.meta.dirname, "../../../../docs/legal");
const mdPath = resolve(legal, "privacy-policy.md");
const historyDir = resolve(legal, "history");
const markdown = policyMarkdown(POLICY, UPCOMING_POLICY);
/** 가장 늦게 시행되는 판. 예정 판을 POLICY로 옮긴 뒤에도 같은 검사가 그대로 돈다. */
const latest = UPCOMING_POLICY?.policy ?? POLICY;
const textOf = (policy: Policy, id: string) =>
  (policy.sections.find((s) => s.id === id)?.blocks ?? [])
    .flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.rows.flat()))
    .join("\n");
const sectionText = (id: string) => textOf(latest, id);
const lineOf = (policy: Policy, id: string, start: string) =>
  textOf(policy, id)
    .split("\n")
    .find((l) => l.startsWith(start)) ?? "";
/** 6항 방 링크 미리보기 항목을 문장으로 나눈 것. 문장마다 한 가지를 적는다(B안). */
const previewSentences = (policy: Policy) =>
  lineOf(policy, "third-party", "방 링크의 미리보기에는")
    .split(/(?<=\.)\s+/)
    .filter(Boolean);

/** 이 판(설명 보완판)의 보존본 머리 주석. 이 판이 지금 판인 동안은 테스트가 POLICY에서 다시 만들고, 다음 판을 옮길 때 이 파일 그대로 고정한다. */
const REVISION_NOTE = `${koreanDate(REVISION_DATE, { year: true })} 설명 보완판(6항 설명 보완)의 보존본. web/src/app/privacy/policy.ts의 그 판에서 만들었다. 그 판의 기록이라 고치지 않는다.`;
/** 보존본: 그 판의 md 전문에서 머리의 안내 주석(policy.ts에서 만든다는 말)만 `note`로 바꾼다. */
const archive = (policy: Policy, note: string) => policyMarkdown(policy).replace(/^<!-- .+ -->$/m, `<!-- ${note} -->`);
/** 고정한 보존본의 SHA-256. 보존본은 그 판의 기록이라 고치지 않는다. */
const FROZEN_HISTORY: Record<string, string> = {
  [HISTORY.threeStepRule.file]: "9ebf1aa8b1095610d5b76e2a488b68bc73894634caa28cbb43421cb9f8d5db84",
};

describe("개인정보 처리방침", () => {
  it("docs/legal/privacy-policy.md가 페이지와 같은 원본에서 나온다", () => {
    if (process.env.UPDATE_PRIVACY_MD) writeFileSync(mdPath, markdown);
    expect(readFileSync(mdPath, "utf8"), "policy.ts를 고쳤다면 UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy").toBe(
      markdown,
    );
  });

  it("이전 판 보존본(docs/legal/history/): 지금 판의 보존본은 POLICY에서 나오고, 고정한 보존본은 바뀌지 않는다", () => {
    const revision = resolve(historyDir, HISTORY.revision.file);
    const expected = archive(POLICY, REVISION_NOTE);
    if (process.env.UPDATE_PRIVACY_MD) writeFileSync(revision, expected);
    expect(readFileSync(revision, "utf8"), "UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy").toBe(expected);
    for (const [file, hash] of Object.entries(FROZEN_HISTORY)) {
      const sha = createHash("sha256")
        .update(readFileSync(resolve(historyDir, file)))
        .digest("hex");
      expect(sha, `${file}은 이전 판의 기록이라 고치지 않는다`).toBe(hash);
    }
    // REVISION_DATE를 옮기면 옛 이름의 보존본이 남지 않게 지운다.
    expect(readdirSync(historyDir).sort()).toEqual(
      Object.values(HISTORY)
        .map((h) => h.file)
        .sort(),
    );
  });

  it("11월 28일 시행판 보존본은 그 판의 전문이다: 15항 세 단계 규칙과 11월 28일 시행일 줄", () => {
    const text = readFileSync(resolve(historyDir, HISTORY.threeStepRule.file), "utf8");
    expect(text.startsWith(`# ${POLICY.title}\n`)).toBe(true);
    expect(text).toContain("이 개인정보 처리방침은 2026년 11월 28일부터 적용됩니다.");
    expect(text).toContain("- 설명 보완·표현 정리: ");
    expect(text).toContain(HISTORY.threeStepRule.source);
    expect(text).not.toContain("## 예정된 변경");
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
    const line = markdown.split("\n").find((l) => l.includes("방 링크의 미리보기에는"));
    expect(line).toContain("약속 날짜·시각");
  });

  it("방 미리보기 그림의 막차 줄은 지금 판 6항의 미리보기 안내에 막차를 적은 뒤에만 켠다", () => {
    // 6항은 방 링크 미리보기에 보이는 것을 적는다. 적지 않은 것(귀갓길 막차 시각)을 그림에 먼저 싣지 않는다. 문장마다 본다.
    const sentences = previewSentences(POLICY);
    expect(sentences.length).toBeGreaterThan(1);
    expect(
      !ROOM_PREVIEW_LAST_TRAIN || sentences.some((s) => s.includes("미리보기 그림") && s.includes("막차")),
      "ROOM_PREVIEW_LAST_TRAIN을 켜려면 지금 판(POLICY) 6항의 방 링크 미리보기 안내에 그림의 귀갓길 막차 시각 문장을 먼저 적으세요.",
    ).toBe(true);
  });

  it("6항 지금 판(설명 보완판): 방 링크 미리보기는 기존 범위 그대로다(막차·지도 한가운데 비교 없음)", () => {
    const sentences = previewSentences(POLICY);
    expect(sentences[0]).toBe(
      "방 링크의 미리보기에는 보내는 때의 방 상태가 보입니다: 1위 역이나 방에서 정한 역, 참여자별 이름과 소요시간, 정한 사람과 약속 날짜·시각·시간대.",
    );
    expect(sentences.join(" ")).not.toContain("막차");
    expect(sentences.join(" ")).not.toContain("가운데");
    expect(ROOM_PREVIEW_LAST_TRAIN).toBe(false);
  });

  it.each([
    ["지금 판", POLICY],
    ["다음 판", latest],
  ])(
    "6항 %s: 미리보기 이름은 입력한 이름이고, 그림에서는 글자를 빼거나 줄이거나 '참가자 N'으로 보일 수 있다",
    (_, policy) => {
      const names = previewSentences(policy).filter((s) => s.includes("이름"));
      expect(names).toContain(
        "이름을 입력한 사람은 그 이름이, 이름 없이 출발역을 공개한 사람은 출발역 이름이 보이고, 이름 없이 출발역을 숨긴 사람은 '참가자 N'으로 보입니다.",
      );
      expect(names.join(" ")).toContain("미리보기 그림에서는 그림 글꼴에 없는 글자(이모지 등)를 빼고 긴 이름은 줄이며");
      expect(names.join(" ")).not.toContain("이름을 넣지 않은 사람은 출발역 이름, 출발역을 숨긴 사람은");
    },
  );

  it("6항 다음 판(방 링크 미리보기): 문장마다 막차·지도 한가운데·미리보기 응답·가져가는 때를 적는다", () => {
    expect(UPCOMING_POLICY).not.toBeNull();
    const sentences = previewSentences(latest);
    const one = (word: string) => {
      const found = sentences.filter((s) => s.includes(word));
      expect(found, word).toHaveLength(1);
      return found[0] ?? "";
    };
    expect(sentences[0]).toContain("메신저가 그 링크의 미리보기를 처음 가져갈 때의 방 상태가 보입니다");
    expect(sentences.join(" ")).not.toContain("보내는 때의 방 상태");
    const lastTrain = one("귀갓길 막차 시각");
    expect(lastTrain).toContain("미리보기 그림에는 출발역을 공개한 참여자의 귀갓길 막차 시각");
    expect(lastTrain).toContain("출발역을 숨긴 사람의 막차 시각은 넣지 않습니다");
    const middle = one("견준 문장");
    expect(middle).toContain("만남 후보 중 출발역들의 가운데에 가장 가까운 역");
    expect(middle).toContain("미리보기 그림과 글(카카오톡 공유 메시지 포함)");
    expect(middle).toContain("출발역을 숨긴 사람이 있으면 넣지 않습니다");
    const api = one("서버 응답");
    expect(api).toContain("방 ID만 있으면 누구나 받을 수 있으며");
    expect(api).toContain("지도 한가운데 역과 그 역까지 참여자별 소요시간");
    // '지도상 가운데'처럼 실제 선택 범위(만남 후보)보다 넓게 쓰지 않는다.
    expect(textOf(latest, "third-party")).not.toContain("지도상 가운데");
  });

  it("6항 설명 보완(1단계, 이미 나간 기능): 방 화면의 막차, 숨긴 사람은 본인만, 막차 확인 버튼, 혼자 입력한 링크", () => {
    for (const policy of [POLICY, latest]) {
      const room = lineOf(policy, "third-party", "방 링크를 가진 사람은");
      expect(room).toContain("출발역을 공개한 사람의 귀갓길 막차 시각을 볼 수 있습니다");
      expect(room).toContain("출발역을 숨긴 사람의 막차 시각은 본인만 봅니다");
      const hidden = lineOf(policy, "third-party", "출발역을 숨기면");
      expect(hidden).toContain("귀갓길 막차 시각은 그 사람 본인의 화면에만 보이며");
      const map = lineOf(policy, "third-party", "길찾기 버튼이나");
      expect(map).toContain("'지도 앱에서 막차 확인하기'");
      expect(map).toContain("이 길찾기 정보는 버튼을 누를 때 보냅니다");
      expect(map).not.toContain("아무것도 전달하지 않습니다");
      // 혼자 입력한 링크에는 숨기기가 없다: 방의 숨김 규칙이 있는 것처럼 쓰지 않는다.
      const solo = lineOf(policy, "third-party", "혼자 입력한 결과의 링크 주소에는");
      expect(solo).toContain("입력한 출발역과 이름이 그대로 담기며, 혼자 입력할 때는 출발역을 숨기는 기능이 없습니다");
      expect(solo).toContain("시간대를 골랐으며 계산할 수 있을 때는 사람별 귀갓길 막차 시각도 보입니다");
      expect(solo).toContain("만남 후보 중 출발역들의 가운데에 가장 가까운 역");
      expect(solo).not.toContain("숨긴 사람");
    }
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

  it.each([
    ["지금 판", POLICY],
    ["다음 판", latest],
  ])("15항 %s: 이전 판 이름이 모두 그 판의 전문으로 이어지는 링크다", (_, policy) => {
    const line = textOf(policy, "changes");
    const links = [...line.matchAll(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g)].map(([, label = "", url = ""]) => ({
      label,
      url,
    }));
    for (const commit of ["57a068a", "267cda0", "bd083b5", "ecd3a47"]) {
      expect(links.map((l) => l.url)).toContain(
        `https://github.com/y2gcoder/banbanyeok/blob/${commit}/docs/legal/privacy-policy.md`,
      );
    }
    expect(links).toContainEqual({ label: "2026년 11월 28일 시행판", url: historyUrl(HISTORY.threeStepRule.file) });
    // 저장소 안 보존본으로 잇는 링크는 그 파일이 있어야 한다.
    for (const { url } of links.filter((l) => l.url.includes("/blob/main/"))) {
      expect(existsSync(resolve(legal, url.split("/docs/legal/")[1] ?? "")), url).toBe(true);
    }
    // 이전 판은 한 줄에 판 하나: 링크로 시작하고 적용 기간이 뒤따른다(화면에서 링크끼리 겹치지 않는다).
    const versions = line.split("\n").filter((l) => l.startsWith("["));
    expect(versions.map((l) => [...l.matchAll(/\]\(https:/g)].length)).toEqual(versions.map(() => 1));
    expect(line).toContain(
      "세 번째 개정판](https://github.com/y2gcoder/banbanyeok/blob/ecd3a47/docs/legal/privacy-policy.md): 2026년 11월 17일부터 11월 27일까지 적용했습니다.",
    );
    expect(line).toContain(`: 세 번째 개정판에서 15항만 바꾼 판입니다. ${threeStepRulePeriod()} 적용했습니다.`);
    expect(textOf(policy, "changes")).toContain("같은 날 세 번 고쳤습니다");
  });

  it("15항 다음 판: 이전 판에 설명 보완판(보존본)과 그 적용 기간이 붙는다", () => {
    const line = textOf(latest, "changes");
    const revision = `${koreanDate(REVISION_DATE, { year: true })} 설명 보완판`;
    expect(line).toContain(
      `[${revision}](${historyUrl(HISTORY.revision.file)}): ${koreanDate(REVISION_DATE, { year: true })}부터 ${koreanDate(addDays(PREVIEW_EFFECTIVE_DATE, -1), { year: true })}까지 적용했습니다.`,
    );
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

  it("15항(2026-11-28 시행판부터): 변경 알림을 세 단계로 나누고 30일 전 규칙은 없다", () => {
    const text = sectionText("changes");
    const rules = text.split("\n").filter((line) => /^(설명 보완|그 밖의 변경|동의를 받아)/.test(line));
    expect(rules).toHaveLength(3);
    expect(rules[0]).toContain("바로 시행하고, 아래 변경 이력에 날짜와 요지를 적고 이전 판의 링크를 남깁니다");
    for (const unchanged of ["항목", "처리 목적", "보유 기간", "처리 위탁과 국외 이전", "제3자 제공"]) {
      expect(rules[0]).toContain(unchanged);
    }
    // schedule.ts의 검사(MIN_NOTICE_DAYS)와 같은 기간을 약속한다.
    expect(rules[1]).toContain(`시행 ${MIN_NOTICE_DAYS}일 전부터 서비스 화면에 알리고`);
    // CONSENT_VERSION을 올리면 낡은 기록이 무효가 되어 다시 동의할 때까지 통계를 켜지 않는다(lib/analytics/consent.ts).
    expect(rules[2]).toContain("동의를 다시 받습니다. 다시 동의하기 전에는 이용 통계를 모으지 않습니다.");
    expect(rules.join("\n")).not.toContain("30일 전");
  });

  it("이번 판의 날짜는 REVISION_DATE 한 곳에서 나온다: 시행일 줄·변경 이력·11월 28일 시행판의 적용 기간·다음 판 공지 기간", () => {
    // 15항 1단계(설명 보완은 바로 시행)가 생긴 날보다 이를 수 없고, 실제 달력의 날짜다.
    expect(REVISION_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(new Date(`${REVISION_DATE}T00:00:00Z`).toISOString().slice(0, 10)).toBe(REVISION_DATE);
    expect(REVISION_DATE >= THREE_STEP_RULE_DATE).toBe(true);
    const day = koreanDate(REVISION_DATE, { year: true });
    const text = textOf(POLICY, "changes");
    expect(text.split("\n")[0]).toBe(`이 개인정보 처리방침은 ${day}부터 적용됩니다.`);
    expect(text).toContain(`변경 이력: ${day} 설명 보완판은 이미 제공하던 기능에 맞춰 6항의 설명을 보완했습니다.`);
    expect(HISTORY.revision.file).toBe(`${REVISION_DATE}-section6.md`);
    // 다음 판: 같은 날 공지를 시작하고 공지 기간(15항 '시행 7일 전')을 꽉 채운 날에 시행한다.
    expect(UPCOMING_POLICY?.noticeFrom).toBe(REVISION_DATE);
    expect(PREVIEW_EFFECTIVE_DATE).toBe(addDays(REVISION_DATE, MIN_NOTICE_DAYS));
    expect(UPCOMING_POLICY?.effectiveDate).toBe(PREVIEW_EFFECTIVE_DATE);
    const next = textOf(latest, "changes");
    expect(next.split("\n")[0]).toBe(
      `이 개인정보 처리방침은 ${koreanDate(PREVIEW_EFFECTIVE_DATE, { year: true })}부터 적용됩니다.`,
    );
    expect(next).toContain(`그 밖의 변경 규칙에 따라 ${day}부터 서비스 화면에 알렸습니다.`);
  });

  it("병합·배포가 늦어지면 11월 28일 시행판의 적용 기간이 그 전날까지로 늘어난다", () => {
    expect(threeStepRulePeriod("2026-11-28")).toBe("2026년 11월 28일 하루(같은 날 설명 보완판을 시행하기 전까지)");
    expect(threeStepRulePeriod("2026-11-29")).toBe("2026년 11월 28일 하루");
    expect(threeStepRulePeriod("2026-12-02")).toBe("2026년 11월 28일부터 2026년 12월 1일까지");
    expect(threeStepRulePeriod("2027-01-01")).toBe("2026년 11월 28일부터 2026년 12월 31일까지");
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
  });

  it("다음 판(방 링크 미리보기)은 2단계로 알린다: 7일 공지, 전후 비교표(미리보기 응답·그림·글·가져가는 때)", () => {
    expect(upcomingProblems(UPCOMING_POLICY)).toEqual([]);
    const items = (UPCOMING_POLICY?.changes ?? []).map((c) => c.item);
    expect(items).toEqual([
      "방 미리보기 응답: 방 ID만 있으면 누구나 받는 값 (6항)",
      "메신저 미리보기 그림 (6항)",
      "메신저 미리보기 글·카카오톡 공유 메시지 (6항)",
      "미리보기에 보이는 방 상태 (6항)",
    ]);
    // 6항과 15항만 바뀐다. 나머지 절은 지금 판 그대로다.
    for (const [index, section] of POLICY.sections.entries()) {
      const next = latest.sections[index];
      if (section.id === "third-party" || section.id === "changes") expect(next).not.toEqual(section);
      else expect(next).toBe(section);
    }
    expect(textOf(latest, "changes")).toContain("설명 보완·표현 정리: ");
  });

  it("목차 앵커가 겹치지 않는다", () => {
    const ids = POLICY.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
