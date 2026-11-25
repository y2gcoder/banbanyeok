"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** 기기의 '동작 줄이기' 설정. 켜져 있으면 뽑기 그림을 움직이지 않고 결과만 보인다. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(QUERY);
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 첫 렌더에서 바로 읽는다(그림을 한 프레임도 움직이지 않으려고). 서버 렌더링에서는 false. */
export function prefersReducedMotionNow(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}
