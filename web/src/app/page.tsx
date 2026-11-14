import { Wordmark } from "@/components/common/wordmark";
import { HomeForm } from "@/components/home/home-form";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 pt-5 pb-10">
      <header>
        <Wordmark />
      </header>
      <section aria-labelledby="home-title" className="flex flex-col gap-2">
        <h1 id="home-title" className="text-[32px] leading-[1.18] font-extrabold tracking-[-0.03em] text-ink">
          우리 어디서 만나야
          <br />덜 억울할까?
        </h1>
        <p className="text-[17px] text-ink-soft">각자 지하철 시간으로 계산해요</p>
      </section>
      <HomeForm />
    </main>
  );
}
