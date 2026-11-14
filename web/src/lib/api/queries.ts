import { queryOptions } from "@tanstack/react-query";
import { type RecommendQuery, recommend } from "./client";

const responseMillis = new WeakMap<object, number>();

/**
 * 이 결과를 서버에서 받는 데 걸린 시간(밀리초). 통계(응답 시간 구간)용이며 한 번만 꺼낼 수 있다:
 * 같은 결과가 캐시에서 다시 보일 때는 서버를 부르지 않았으므로 값이 없어야 한다.
 */
export function takeResponseMillis(result: object): number | undefined {
  const millis = responseMillis.get(result);
  responseMillis.delete(result);
  return millis;
}

export function recommendQueryOptions(query: RecommendQuery) {
  return queryOptions({
    // 별칭은 표시 이름과 문장을 바꾸므로 키에 넣는다.
    queryKey: ["recommend", query.origins.join("."), query.mode, query.favorIndex, query.nicknames] as const,
    queryFn: async ({ signal }) => {
      const started = performance.now();
      const result = await recommend(query, signal);
      responseMillis.set(result, Math.round(performance.now() - started));
      return result;
    },
    // 같은 입력이면 같은 데이터 버전 안에서 결과가 같다. 모드를 오가며 다시 부르지 않는다.
    staleTime: 5 * 60_000,
  });
}
