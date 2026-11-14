import { InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { Notice } from "@/lib/display/notices";

/** 극단 상황 안내. 버튼("○○ 쪽으로 보기")은 배려 모드로 바꾼다. */
export function Notices({ notices, onFavor }: { notices: readonly Notice[]; onFavor: (index: number) => void }) {
  if (notices.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="안내">
      {notices.map((notice) => {
        const warning = notice.kind === "LONG_TRAVEL" || notice.kind === "NO_COMMON_CANDIDATE";
        const Icon = warning ? TriangleAlertIcon : InfoIcon;
        return (
          <li
            key={notice.kind}
            className={
              warning
                ? "flex gap-2.5 rounded-xl border border-safety bg-[color-mix(in_oklch,var(--safety)_14%,var(--surface))] px-3.5 py-3"
                : "flex gap-2.5 rounded-xl border border-rule bg-surface px-3.5 py-3"
            }
          >
            <Icon className="mt-0.5 size-[18px] shrink-0 text-ink" aria-hidden="true" />
            <div className="flex flex-col items-start gap-2">
              <p className="text-[15px] leading-snug text-ink">{notice.text}</p>
              {notice.cta ? (
                <button
                  type="button"
                  onClick={() => notice.cta && onFavor(notice.cta.favorIndex)}
                  className="rounded-md text-[15px] font-bold text-ink underline underline-offset-4"
                >
                  {notice.cta.label}
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
