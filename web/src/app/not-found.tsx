import Link from "next/link";
import { Wordmark } from "@/components/common/wordmark";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pt-5 pb-10">
      <Wordmark />
      <h1 className="text-[24px] font-extrabold text-ink">없는 페이지예요</h1>
      <Link href="/" className="text-[17px] font-bold text-ink underline underline-offset-4">
        만날 역 찾기로 가기
      </Link>
    </main>
  );
}
