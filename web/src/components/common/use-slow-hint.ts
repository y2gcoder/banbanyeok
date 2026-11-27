"use client";

import { useEffect, useState } from "react";

/**
 * 서버가 콜드스타트로 깨는 중일 때의 안내 단계. 기다린 시간이 `firstMs`를 넘으면 1, `secondMs`를 넘으면 2.
 * 콜드 첫 요청은 3~5초 걸릴 수 있으므로(p50 3.7초) 그 시간 동안 화면이 멈춘 것처럼 보이지 않게 문구를 단계적으로 바꾼다.
 */
export function useSlowStage(waiting: boolean, firstMs = 2500, secondMs = 8000): 0 | 1 | 2 {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if (!waiting) {
      setStage(0);
      return;
    }
    const first = setTimeout(() => setStage(1), firstMs);
    const second = setTimeout(() => setStage(2), secondMs);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [waiting, firstMs, secondMs]);
  return stage;
}

const MESSAGES = [
  (what: string) => `${what} 중이에요.`,
  (what: string) => `서버를 깨우는 중이에요. ${what}까지 몇 초 걸릴 수 있어요.`,
  (what: string) => `조금 오래 걸리네요. 계속 ${what} 중이에요. 잠시만 기다려 주세요.`,
] as const;

/** 단계별 안내 문구. `what`은 "방을 불러오는"처럼 관형형으로 끝나는 말이 아니라 "방을 불러오기"처럼 명사형이다. */
export function slowMessage(stage: 0 | 1 | 2, what: string): string {
  return MESSAGES[stage](what);
}
