import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { RoomPreview } from "@/lib/api/types";
import { INVITE_COPY, roomShareCopy } from "@/lib/room/share-copy";
import { policyMarkdown } from "./markdown";
import { CONTACT_EMAIL, POLICY, PROCESSOR_CONTACT_EMAILS } from "./policy";

const mdPath = resolve(import.meta.dirname, "../../../../docs/legal/privacy-policy.md");
const markdown = policyMarkdown(POLICY);

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

  it("카카오톡 공유: 모든 공유 버튼 이름으로, 누를 때 카카오로 가는 것과 누르기 전에는 SDK를 받지 않는다는 것을 적는다", () => {
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
    expect(line).toContain("이 버튼을 누르기 전에는 카카오 공유 프로그램을 받지 않으며");
  });

  it("목차 앵커가 겹치지 않는다", () => {
    const ids = POLICY.sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
