import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RoomPreview } from "@/lib/api/types";
import { INVITE_COPY, ROOM_PREVIEW_LAST_TRAIN, roomShareCopy } from "@/lib/room/share-copy";
import { policyMarkdown } from "./markdown";
import { CONTACT_EMAIL, POLICY, PROCESSOR_CONTACT_EMAILS, UPCOMING_POLICY } from "./policy";
import { koreanDate, MIN_NOTICE_DAYS } from "./schedule";
import { FIXTURE_UPCOMING } from "./upcoming.fixture";

const mdPath = resolve(import.meta.dirname, "../../../../docs/legal/privacy-policy.md");
const markdown = policyMarkdown(POLICY, UPCOMING_POLICY);
/** 가장 늦게 시행되는 판. 예정 판을 POLICY로 옮긴 뒤에도 같은 검사가 그대로 돈다. */
const latest = UPCOMING_POLICY?.policy ?? POLICY;
const sectionText = (id: string) =>
  (latest.sections.find((s) => s.id === id)?.blocks ?? [])
    .flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.rows.flat()))
    .join("\n");

describe("개인정보 처리방침", () => {
  it("docs/legal/privacy-policy.md가 페이지와 같은 원본에서 나온다", () => {
    if (process.env.UPDATE_PRIVACY_MD) writeFileSync(mdPath, markdown);
    expect(readFileSync(mdPath, "utf8"), "policy.ts를 고쳤다면 UPDATE_PRIVACY_MD=1 pnpm test src/app/privacy").toBe(
      markdown,
    );
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
    expect(markdown).toContain("이 개인정보 처리방침은 2026년 11월 17일부터 적용됩니다.");
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

  it("방 미리보기 그림의 막차 줄은 6항의 미리보기 목록에 막차를 적은 뒤에만 켠다", () => {
    // 6항은 방 링크 미리보기에 보이는 것을 목록으로 적는다. 목록에 없는 것(귀갓길 막차 시각)을 그림에 먼저 싣지 않는다.
    const line = markdown.split("\n").find((l) => l.includes("방 링크의 미리보기에는")) ?? "";
    expect(
      !ROOM_PREVIEW_LAST_TRAIN || line.includes("막차"),
      "ROOM_PREVIEW_LAST_TRAIN을 켜려면 6항의 '방 링크의 미리보기에는 …' 목록에 귀갓길 막차 시각을 먼저 적으세요.",
    ).toBe(true);
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

  it("이전 판: 같은 날 앞선 세 판을 모두 공개 저장소의 그 판 기록으로 잇는다", () => {
    const line = markdown.split("\n").find((l) => l.includes("이전 판:")) ?? "";
    for (const commit of ["57a068a", "267cda0", "bd083b5"]) {
      expect(line).toContain(`https://github.com/y2gcoder/banbanyeok/blob/${commit}/docs/legal/privacy-policy.md`);
    }
    expect(markdown).toContain("같은 날 세 번 고쳤습니다");
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

  it("예정 판의 15항 시행일은 effectiveDate와 같고, 이전 판 목록은 2026-11-17 세 번째 개정판(ecd3a47)까지 잇는다", () => {
    if (!UPCOMING_POLICY) return;
    const text = sectionText("changes");
    expect(text).toContain(
      `이 개인정보 처리방침은 ${koreanDate(UPCOMING_POLICY.effectiveDate, { year: true })}부터 적용됩니다.`,
    );
    const line = text.split("\n").find((l) => l.includes("이전 판:")) ?? "";
    for (const commit of ["57a068a", "267cda0", "bd083b5", "ecd3a47"]) {
      expect(line).toContain(`https://github.com/y2gcoder/banbanyeok/blob/${commit}/docs/legal/privacy-policy.md`);
    }
  });

  it("목차 앵커가 겹치지 않는다", () => {
    const ids = POLICY.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
