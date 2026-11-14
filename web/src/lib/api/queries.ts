import { queryOptions } from "@tanstack/react-query";
import { type RecommendQuery, recommend } from "./client";

export function recommendQueryOptions(query: RecommendQuery) {
  return queryOptions({
    // 별칭은 표시 이름과 문장을 바꾸므로 키에 넣는다.
    queryKey: ["recommend", query.origins.join("."), query.mode, query.favorIndex, query.nicknames] as const,
    queryFn: ({ signal }) => recommend(query, signal),
    // 같은 입력이면 같은 데이터 버전 안에서 결과가 같다. 모드를 오가며 다시 부르지 않는다.
    staleTime: 5 * 60_000,
  });
}
