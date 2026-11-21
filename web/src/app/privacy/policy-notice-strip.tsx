"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  type ChangeNoticeWindow,
  changeNoticeShown,
  koreanDate,
  kstDate,
  type NoticeWindow,
  noticePhase,
} from "./schedule";

const subscribe = () => () => {};
const today = () => kstDate(new Date());
/** 서버(정적 HTML)와 첫 하이드레이션에서는 오늘을 모른다: 공지를 그리지 않고, 브라우저가 이어받은 뒤 날짜를 보고 정한다. */
const serverToday = () => null;

/**
 * 첫 화면 맨 위의 한 줄 공지. 처리방침 예정 판이 있고 공지 기간(공지 시작일 ≤ 오늘 < 시행일, 한국 시간)일 때만 보인다.
 * 첫 화면은 정적 페이지라 날짜는 브라우저가 판단한다. 그래서 재배포 없이 공지가 켜지고, 시행일 0시에 사라진다.
 * 문서 흐름 안에 있어서(고정·sticky 아님) 화면 아래의 통계 동의 배너와 겹치거나 밀어내지 않는다. 닫기는 두지 않는다
 * (법적으로 알려야 하는 안내라 한 줄로 줄여 늘 보이게 한다).
 */
export function PolicyNoticeStrip({ noticeFrom, effectiveDate }: NoticeWindow) {
  const now = useSyncExternalStore(subscribe, today, serverToday);
  if (now === null || noticePhase({ noticeFrom, effectiveDate }, now) !== "notice") return null;
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface py-0.5 pr-2 pl-3.5 text-[14px] leading-snug text-ink">
      <p className="min-w-0 py-1.5">개인정보 처리방침이 {koreanDate(effectiveDate, { today: now })}부터 바뀝니다</p>
      <Link
        href="/privacy#policy-notice"
        className="inline-flex min-h-11 shrink-0 items-center rounded-md px-1.5 font-bold underline underline-offset-4"
      >
        자세히
      </Link>
    </div>
  );
}

/**
 * 첫 화면 맨 위의 한 줄 안내: 중요한 처리방침 변경이 있었고 안내 기간(시행일 ≤ 오늘 ≤ 끝나는 날, 한국 시간)일 때만 보인다(15항).
 * 날짜는 브라우저가 판단하므로 재배포 없이 기간이 끝나면 사라진다. 닫기는 두지 않는다.
 */
export function PolicyChangeStrip({ since, until }: ChangeNoticeWindow) {
  const now = useSyncExternalStore(subscribe, today, serverToday);
  if (now === null || !changeNoticeShown({ since, until }, now)) return null;
  return (
    <div className="flex w-full items-center justify-between gap-3 rounded-xl border border-rule-strong bg-surface py-0.5 pr-2 pl-3.5 text-[14px] leading-snug text-ink">
      <p className="min-w-0 py-1.5">개인정보 처리방침이 {koreanDate(since, { today: now })}부터 바뀌었습니다</p>
      <Link
        href="/privacy#policy-change"
        className="inline-flex min-h-11 shrink-0 items-center rounded-md px-1.5 font-bold underline underline-offset-4"
      >
        자세히
      </Link>
    </div>
  );
}
