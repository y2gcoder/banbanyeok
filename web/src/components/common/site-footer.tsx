import Link from "next/link";

/**
 * 모든 화면 맨 아래의 사이트 공통 링크(루트 레이아웃이 붙인다). SEO 페이지의 `<footer>`(데이터 기준)와
 * contentinfo 랜드마크가 겹치지 않도록 이름 붙인 nav로 둔다. 작성지침(2026. 4.)대로 "개인정보 처리방침" 명칭을
 * 쓰고 굵게 표시해 다른 안내와 구분한다.
 */
export function SiteFooter() {
  return (
    <nav aria-label="사이트 정보" className="mx-auto w-full max-w-2xl border-t border-rule px-5 pt-4 pb-8 text-[14px]">
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        <li>
          <Link
            href="/privacy"
            className="inline-flex min-h-11 items-center rounded-md font-bold text-ink underline underline-offset-4"
          >
            개인정보 처리방침
          </Link>
        </li>
        <li>
          <Link
            href="/privacy#analytics-settings"
            className="inline-flex min-h-11 items-center rounded-md font-semibold text-ink-soft underline underline-offset-4"
          >
            통계 설정
          </Link>
        </li>
      </ul>
    </nav>
  );
}
