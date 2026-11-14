import Link from "next/link";

/** 반반 나뉜 원(두 사람의 시간이 반반) + 이름. */
export function Wordmark() {
  return (
    <Link href="/" className="inline-flex items-center gap-2 rounded-md font-extrabold tracking-tight text-ink">
      <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="var(--surface)" stroke="var(--ink)" strokeWidth="3" />
        <path d="M12 2a10 10 0 0 1 0 20z" fill="var(--ink)" />
      </svg>
      <span className="text-lg">반반역</span>
    </Link>
  );
}
