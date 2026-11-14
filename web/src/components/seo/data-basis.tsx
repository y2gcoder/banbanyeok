import { dataVersionDate } from "@/lib/seo/pairs";

/** 숫자가 어떤 데이터로 나왔는지 밝히는 안내(데이터 기준·출처·한계). SEO 페이지 공통 하단. */
export function DataBasis({ dataVersion, isSample }: { dataVersion: string; isSample: boolean }) {
  const { year, month, day } = dataVersionDate(dataVersion);
  return (
    <footer className="mt-10 flex flex-col gap-3 border-t border-rule pt-6 text-[13px] leading-relaxed text-muted-foreground">
      {isSample ? (
        <p role="note" className="rounded-md bg-safety/30 px-3 py-2 font-semibold text-safety-ink">
          개발용 표본 데이터예요. 실제 추천이 아니에요.
        </p>
      ) : null}
      <h2 className="text-sm font-bold text-ink">데이터 기준</h2>
      <p>
        {year}년 {month}월 {day}일 데이터(버전 {dataVersion})로 계산했어요. 역에서 역까지 걸리는 시간이고, 열차 대기와
        환승 시간을 평균으로 넣은 추정치예요. 역까지 걸어가는 시간은 빠져 있어요. 공식 시간표나 실시간 안내가 아니니
        출발 전에 지도 앱으로 한 번 더 확인해 주세요.
      </p>
      <p>
        출처: 국가철도공단 전국도시철도역사정보, 서울교통공사 역간거리·소요시간과 환승역거리 소요시간(공공누리 제1유형,
        가공함). 순위는 가장 오래 걸리는 사람의 시간이 짧은 순서이고, 같으면 시간 차이가 작은 쪽을 앞에 둬요.
      </p>
    </footer>
  );
}
