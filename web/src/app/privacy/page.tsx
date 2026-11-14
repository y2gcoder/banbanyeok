import type { Metadata } from "next";
import { Wordmark } from "@/components/common/wordmark";
import { ConsentSettings } from "@/components/consent/consent-settings";
import { type Block, POLICY } from "./policy";

// 초안이라 검색 색인에서 뺀다. 운영자 검토 후 공개할 때 robots를 지운다(docs/setup/l1-notes.md).
export const metadata: Metadata = {
  title: "개인정보 처리방침",
  description: "반반역이 처리하는 개인정보 항목, 보유 기간, 국외 이전, 이용자 권리를 안내합니다.",
  robots: { index: false },
};

function PolicyBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p>{block.text}</p>;
    case "list":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case "table":
      return <PolicyTable block={block} />;
  }
}

type TableBlock = Extract<Block, { kind: "table" }>;

/** 좁은 화면(모바일 우선)에서는 행마다 카드로, 넓은 화면에서는 표로 보인다. 가로 스크롤을 만들지 않는다. */
function PolicyTable({ block }: { block: TableBlock }) {
  const [firstHead, ...restHead] = block.head;
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={block.caption} className="flex flex-col gap-2 sm:hidden">
        {block.rows.map(([title, ...values]) => (
          <li key={title} className="flex flex-col gap-2 rounded-xl border border-rule bg-surface p-4">
            <p className="font-bold text-ink">
              <span className="sr-only">{firstHead}: </span>
              {title}
            </p>
            <dl className="flex flex-col gap-2">
              {values.map((value, i) => (
                <div key={restHead[i]} className="flex flex-col">
                  <dt className="text-[13px] font-semibold text-muted-foreground">{restHead[i]}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      <table className="hidden w-full border-collapse overflow-hidden rounded-xl bg-surface text-left text-[14px] leading-relaxed sm:table">
        <caption className="pb-2 text-left text-[14px] font-bold text-ink">{block.caption}</caption>
        <thead className="bg-muted">
          <tr>
            {block.head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-bold text-ink">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map(([title, ...values]) => (
            <tr key={title} className="border-t border-rule align-top">
              <th scope="row" className="px-3 py-2 font-semibold text-ink">
                {title}
              </th>
              {values.map((value, i) => (
                <td key={restHead[i]} className="px-3 py-2 text-ink-soft">
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 정적 본문이라 블록의 첫 문장이 곧 고유한 키다. */
function blockKey(block: Block): string {
  if (block.kind === "p") return block.text;
  if (block.kind === "list") return block.items[0] ?? "";
  return block.caption;
}

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pt-5 pb-10 text-[15px] leading-relaxed text-ink-soft">
      <header>
        <Wordmark />
      </header>
      <section aria-labelledby="privacy-title" className="flex flex-col gap-4">
        <h1 id="privacy-title" className="text-[28px] leading-tight font-extrabold tracking-[-0.02em] text-ink">
          {POLICY.title}
        </h1>
        <p role="note" className="rounded-xl border-2 border-safety bg-surface p-4 font-semibold text-ink">
          {POLICY.draftWarning}
        </p>
        {POLICY.intro.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </section>

      <section aria-labelledby="privacy-summary" className="flex flex-col gap-3 rounded-2xl bg-surface p-5">
        <h2 id="privacy-summary" className="text-[18px] font-bold text-ink">
          한눈에 보기
        </h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {POLICY.summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section
        aria-labelledby="analytics-settings-title"
        id="analytics-settings"
        className="flex scroll-mt-4 flex-col gap-3 rounded-2xl bg-surface p-5"
      >
        <h2 id="analytics-settings-title" className="text-[18px] font-bold text-ink">
          통계 설정
        </h2>
        <ConsentSettings />
      </section>

      <nav aria-labelledby="privacy-toc" className="flex flex-col gap-3">
        <h2 id="privacy-toc" className="text-[18px] font-bold text-ink">
          목차
        </h2>
        <ol className="flex flex-col gap-1">
          {POLICY.sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex min-h-8 items-center rounded-md font-semibold text-ink underline underline-offset-4"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {POLICY.sections.map((s) => (
        <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="flex scroll-mt-4 flex-col gap-3">
          <h2 id={`${s.id}-title`} className="text-[20px] leading-snug font-extrabold text-ink">
            {s.title}
          </h2>
          {s.blocks.map((b) => (
            <PolicyBlock key={blockKey(b)} block={b} />
          ))}
        </section>
      ))}
    </main>
  );
}
