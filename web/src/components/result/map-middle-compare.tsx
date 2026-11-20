import { useId } from "react";
import { personColor } from "@/components/common/person-color";
import { formatMinutes } from "@/lib/display/minutes";
import { type MapMiddleView, middleSentence } from "@/lib/result/map-middle";
import type { CandidateView } from "@/lib/result/view-model";
import { parenSafe } from "@/lib/text/paren-safe";

/**
 * 1위 카드 안의 "지도 한가운데였다면?" 표(#68). 추천 역 칸은 노랗게, 지도 한가운데 역 칸은 흐리게 둔다.
 * 마지막 줄은 "차이"가 아니라 "가장 오래"다: 공평 기준이 가장 오래 걸리는 사람의 시간을 줄이는 것이라, 그 값을 견주어야 비교가 맞다.
 * 사람 색은 막대에만 쓰고 글자는 ink/muted만 쓴다(globals.css 규칙). 값이 없으면 이 구성요소를 그리지 않는다(호출하는 쪽이 정한다).
 */
export function MapMiddleCompare({ candidate, middle }: { candidate: CandidateView; middle: MapMiddleView }) {
  const headingId = useId();
  const who = candidate.people[middle.personIndex]?.shortName ?? "";
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5 border-t border-rule pt-4">
      <h3 id={headingId} className="text-[15px] font-bold text-ink">
        지도 한가운데였다면?
      </h3>
      <table className="tabular w-full table-fixed border-separate border-spacing-0 overflow-hidden rounded-lg border border-rule text-[14px]">
        <thead>
          <tr>
            <th scope="col" className="w-[34%] px-3 py-2 text-left">
              <span className="sr-only">사람</span>
            </th>
            <th scope="col" className="bg-safety/90 px-2 py-2 text-right font-bold text-ink">
              <span className="block text-[11px] font-semibold text-safety-ink">추천</span>
              <span className="block break-keep [overflow-wrap:anywhere]">{parenSafe(candidate.stationName)}</span>
            </th>
            <th scope="col" className="px-2 py-2 text-right font-bold text-muted-foreground">
              <span className="block text-[11px] font-semibold">지도 한가운데</span>
              <span className="block break-keep [overflow-wrap:anywhere]">{parenSafe(middle.stationName)}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {candidate.people.map((person, i) => (
            <tr key={person.index}>
              <th scope="row" className="border-t border-rule px-3 py-2 text-left font-semibold text-ink">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-3.5 w-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: personColor(person.index) }}
                  />
                  <span className="truncate">{person.shortName}</span>
                </span>
              </th>
              <td className="border-t border-rule bg-safety/25 px-2 py-2 text-right font-bold text-ink">
                {formatMinutes(person.minutes)}
              </td>
              <td className="border-t border-rule px-2 py-2 text-right text-muted-foreground">
                {formatMinutes(middle.minutes[i] ?? 0)}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="border-t-2 border-ink px-3 py-2 text-left font-bold text-ink">
              가장 오래
            </th>
            <td className="border-t-2 border-ink bg-safety/25 px-2 py-2 text-right text-[16px] font-extrabold text-ink">
              {formatMinutes(candidate.aggregate.max)}
            </td>
            <td className="border-t-2 border-ink px-2 py-2 text-right font-bold text-muted-foreground">
              {formatMinutes(middle.max)}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-[14px] leading-snug break-keep text-ink-soft">{parenSafe(middleSentence(middle, who))}</p>
      <p className="text-[13px] leading-snug break-keep text-muted-foreground">
        지도 한가운데는 출발역 위치의 평균에 가장 가까운 역이에요.
      </p>
    </section>
  );
}
