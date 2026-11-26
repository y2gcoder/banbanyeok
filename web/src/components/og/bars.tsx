import { distinctNames } from "@/lib/copy/og-coverage";
import { OG_COLORS, OG_TEXT } from "@/lib/copy/og-text";
import { personHex } from "./frame";

/*
 * 반반지수(#202)의 사람별 막대. 공유 그림(`ScoreboardCard`)과 방 미리보기(`SharedCard`)가 같이 쓴다.
 * 축은 가장 오래 걸리는 사람이 끝이다: 걸리는 시간이 고르면 막대 끝이 가지런하고, 아니면 벌어진다.
 */

/** 굵은 숫자·한글의 대략의 폭(em). satori는 글자 폭을 알려 주지 않으므로 칸에 맞출 때 이 값으로 어림한다. */
export function emWidth(text: string): number {
  return Array.from(text).reduce((sum, ch) => sum + (/[0-9]/.test(ch) ? 0.62 : ch === " " ? 0.3 : 0.95), 0);
}

/**
 * 이름을 `width`(px) 안에 맞춘다. 먼저 글자를 `max`에서 `min`(px)까지 줄이고, 그래도 넘치면 가운데를 말줄임표로 줄인다.
 * 끝은 남긴다: 서버가 같은 이름에 붙인 번호(" 2")가 있으면 번호와 그 앞 한 글자, 없으면 마지막 두 글자. 끝을 자르면 같은 역에서
 * 오는 두 사람("동대문역사문화공원 1"·"… 2")이 같은 글자가 되어 누구의 시간인지 모른다.
 */
export function fitName(name: string, width: number, max: number, min: number): { text: string; size: number } {
  for (let size = max; size >= min; size -= 1) {
    if (emWidth(name) * size <= width) return { text: name, size };
  }
  const chars = Array.from(name);
  const numbered = /^(.*\S) (\d+)$/.exec(name);
  const tailLength = numbered ? Array.from(numbered[2] ?? "").length + 2 : 2;
  const tail = chars.slice(-tailLength).join("");
  for (let head = chars.length - tailLength - 1; head >= 1; head -= 1) {
    const text = `${chars.slice(0, head).join("")}${OG_TEXT.ellipsis}${tail}`;
    if (emWidth(text) * min <= width) return { text, size: min };
  }
  return { text: `${chars[0] ?? ""}${OG_TEXT.ellipsis}${tail}`, size: min };
}

export function fitNames(names: string[], width: (i: number) => number, max: number, min: number) {
  const fitted = names.map((name, i) => fitName(name, width(i), max, min));
  return distinctNames(fitted.map((name) => name.text)).map((text, i) => fitName(text, width(i), max, min));
}

/**
 * 낱말 사이에서만 줄을 바꾸는 글. satori는 `wordBreak: keep-all`이어도 숫자와 한글 사이("34|분이에요")에서 줄을 바꾸므로 낱말마다
 * 줄바꿈 없는 조각으로 둔다.
 */
export function Words({ text, size }: { text: string; size: number }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", columnGap: Math.round(size * 0.3), fontSize: size }}>
      {text.split(" ").map((word, i) => (
        <span key={`w-${String(i)}`} style={{ whiteSpace: "nowrap" }}>
          {word}
        </span>
      ))}
    </div>
  );
}

/** 회색 길 위에 그 사람의 시간만큼 사람 색 막대. 이름·분을 옆에 글자로 쓰므로 색만으로 사람을 가르지 않는다. */
export function BarTrack({
  index,
  minutes,
  axis,
  height,
}: {
  index: number;
  minutes: number;
  axis: number;
  height: number;
}) {
  return (
    <div style={{ display: "flex", flex: 1, height, borderRadius: height / 2, backgroundColor: OG_COLORS.rule }}>
      <div
        style={{
          display: "flex",
          width: `${(minutes / Math.max(1, axis)) * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: personHex(index),
        }}
      />
    </div>
  );
}
