import Link from "next/link";
import { Wordmark } from "@/components/common/wordmark";
import type { LinkErrorCode } from "@/lib/link/codec";

const MESSAGES: Record<LinkErrorCode, string> = {
  MALFORMED_QUERY: "링크 주소가 깨졌어요.",
  MISSING_PARAM: "링크에 필요한 정보가 빠졌어요.",
  DUPLICATE_PARAM: "링크 주소가 깨졌어요.",
  UNSUPPORTED_VERSION: "이 링크는 새 버전에서 만들어졌어요. 페이지를 새로 고쳐 주세요.",
  BAD_ORIGIN_COUNT: "출발역은 2~4곳이어야 해요.",
  BAD_STATION_CODE: "링크의 역 정보를 읽지 못했어요.",
  BAD_MODE: "링크의 추천 기준을 읽지 못했어요.",
  FAVOR_INDEX_OUT_OF_RANGE: "링크의 추천 기준을 읽지 못했어요.",
  BAD_NICKNAMES: "링크의 이름 정보를 읽지 못했어요.",
};

/** 링크를 해석하지 못했을 때. 무엇이 틀렸는지 말하고 새로 찾기로 보낸다. */
export function InvalidLink({ error }: { error: LinkErrorCode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-5 pb-10">
      <Wordmark />
      <div role="alert" className="flex flex-col gap-2">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-ink">링크를 열 수 없어요</h1>
        <p className="text-[17px] text-ink-soft">
          {MESSAGES[error]} 보낸 사람에게 링크를 다시 받거나, 직접 찾아보세요.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-14 items-center justify-center rounded-xl bg-primary text-[17px] font-bold text-primary-foreground"
      >
        만날 역 찾기
      </Link>
    </main>
  );
}
