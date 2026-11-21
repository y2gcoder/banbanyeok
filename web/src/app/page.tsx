import { Wordmark } from "@/components/common/wordmark";
import { HomeForm } from "@/components/home/home-form";
import { CHANGE_NOTICE, UPCOMING_POLICY } from "./privacy/policy";
import { PolicyChangeStrip, PolicyNoticeStrip } from "./privacy/policy-notice-strip";

/**
 * 입력 화면. 폰에서는 한 칸(제목 → 입력), 두 칸 폭(wide, 640px~)부터는 왼쪽에 제목, 오른쪽에 입력 카드를 나란히 둔다.
 * 높이가 충분하면(tall) 왼쪽 제목이 입력 카드 옆에 붙어 있는다.
 * 처리방침 예정 판이 공지 기간이거나 중요한 변경의 안내 기간이면 맨 위에 한 줄 공지가 붙는다. 날짜는 브라우저가 판단해서 이 페이지는
 * 정적 그대로다.
 */
export default function HomePage() {
  return (
    <main className="hinge-split mx-auto grid min-h-dvh w-full max-w-md content-start gap-8 px-gutter pt-5 pb-10 wide:max-w-6xl wide:grid-cols-2 wide:gap-x-6 wide:pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-x-16">
      <div className="flex flex-col gap-8 wide:gap-12 tall:wide:sticky tall:wide:top-8 tall:wide:self-start">
        <header className="flex flex-col items-start gap-3">
          {UPCOMING_POLICY ? (
            <PolicyNoticeStrip noticeFrom={UPCOMING_POLICY.noticeFrom} effectiveDate={UPCOMING_POLICY.effectiveDate} />
          ) : null}
          {CHANGE_NOTICE ? <PolicyChangeStrip since={CHANGE_NOTICE.since} until={CHANGE_NOTICE.until} /> : null}
          <Wordmark />
        </header>
        <section aria-labelledby="home-title" className="flex flex-col gap-2 wide:gap-4">
          <h1
            id="home-title"
            className="text-[32px] leading-[1.18] font-extrabold tracking-[-0.03em] text-ink lg:text-[52px] wide:text-[40px]"
          >
            우리 어디서 만나면
            <br />딱 반반일까?
          </h1>
          <p className="text-[17px] text-ink-soft wide:text-[19px]">각자 지하철 시간으로 계산해요</p>
        </section>
      </div>
      <div className="wide:rounded-2xl wide:border wide:border-rule wide:bg-surface wide:p-4 wide:shadow-[0_1px_0_var(--rule)] lg:p-8">
        <HomeForm />
      </div>
    </main>
  );
}
