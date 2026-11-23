import { parenSafe } from "@/lib/text/paren-safe";
import { cn } from "@/lib/utils";
import { CONSENT_NOTICE } from "./consent-text";

/**
 * 통계 동의의 세부 고지(두 번째 층, [CONSENT_NOTICE]). 배너에서는 '자세히 보기'로 같은 자리에서 펼치고, /privacy 통계 설정에는 늘 보인다.
 * 표 대신 항목·내용 목록(dl)이라 좁은 폰에서도 가로로 넘치지 않는다.
 */
export function ConsentNotice({ id, compact = false }: { id?: string; compact?: boolean }) {
  return (
    <div id={id} className={cn("flex flex-col", compact ? "gap-2 text-[12px] leading-snug" : "gap-3 text-[14px]")}>
      {CONSENT_NOTICE.map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-1">
          <h3 className={cn("font-bold text-ink", compact ? "text-[12.5px]" : "text-[15px]")}>{group.title}</h3>
          <dl className="flex flex-col gap-0.5">
            {group.rows.map((row) => (
              <div key={row.term} className="flex flex-col wide:flex-row wide:gap-2">
                <dt className="shrink-0 font-semibold text-ink wide:w-28">{row.term}</dt>
                <dd className="text-ink-soft">{parenSafe(row.text)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
