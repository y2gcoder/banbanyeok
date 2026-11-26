import { Wordmark } from "@/components/common/wordmark";
import { HomeEntry } from "@/components/home/home-entry";
import { CreateRoomForm } from "@/components/room/create-form";
import { CHANGE_NOTICE, UPCOMING_POLICY } from "./privacy/policy";
import { PolicyChangeStrip, PolicyNoticeStrip } from "./privacy/policy-notice-strip";

/**
 * 제목 아래에서 입력 방식을 고른다. 경첩으로 나뉜 화면에서는 제목과 입력 카드를 각각 한 조각에 둔다.
 * 처리방침 공지 기간은 브라우저가 판단하므로 홈은 정적 페이지로 유지된다.
 */
export default function HomePage() {
  return (
    <main className="hinge-split mx-auto grid min-h-dvh w-full max-w-md content-start gap-5 px-gutter pt-5 pb-10 wide:max-w-2xl wide:pt-8">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-col items-start gap-3">
          {UPCOMING_POLICY ? (
            <PolicyNoticeStrip noticeFrom={UPCOMING_POLICY.noticeFrom} effectiveDate={UPCOMING_POLICY.effectiveDate} />
          ) : null}
          {CHANGE_NOTICE ? <PolicyChangeStrip since={CHANGE_NOTICE.since} until={CHANGE_NOTICE.until} /> : null}
          <Wordmark />
        </header>
        <section aria-labelledby="home-title" className="flex flex-col gap-2">
          <h1
            id="home-title"
            className="text-[32px] leading-[1.18] font-extrabold tracking-[-0.03em] text-ink wide:text-[40px]"
          >
            우리 어디서 만나면
            <br />딱 반반일까?
          </h1>
          <p className="text-[17px] text-ink-soft wide:text-[19px]">각자 지하철 시간으로 계산해요</p>
        </section>
      </div>
      <HomeEntry roomForm={<CreateRoomForm />} />
    </main>
  );
}
