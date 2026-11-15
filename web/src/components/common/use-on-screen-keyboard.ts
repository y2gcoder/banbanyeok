"use client";

import { useSyncExternalStore } from "react";

/** 글자를 치는 칸(체크박스·라디오·버튼류 제외). */
const TEXT_ENTRY =
  "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=reset]):not([type=range]):not([type=color]), textarea, [contenteditable=''], [contenteditable=true]";

/** 화면 키보드가 이만큼(CSS px) 넘게 화면을 가리면 열린 것으로 본다(주소창이 접히고 펴지는 정도의 변화는 무시한다). */
const KEYBOARD_MIN_PX = 150;

function typingTarget(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches(TEXT_ENTRY);
}

/**
 * 지금 화면 키보드가 열려 글자 칸을 치는 중인지.
 *
 * 화면 키보드는 레이아웃 뷰포트는 그대로 두고 보이는 영역(visualViewport)만 줄인다(안드로이드 크롬 기본값, iOS 사파리).
 * 그래서 보이는 영역(확대 배율을 되돌린 높이)이 레이아웃 높이보다 눈에 띄게 작고, 초점이 글자 칸에 있으면 키보드가 열린 것으로 본다.
 * visualViewport가 없는 브라우저에서는 터치 기기(pointer: coarse)에서 글자 칸에 초점이 있으면 열린 것으로 본다.
 */
export function onScreenKeyboardOpen(): boolean {
  if (typeof window === "undefined" || !typingTarget()) return false;
  const vv = window.visualViewport;
  if (!vv) return window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const layoutHeight = document.documentElement.clientHeight;
  return layoutHeight - vv.height * vv.scale > KEYBOARD_MIN_PX;
}

function subscribe(onChange: () => void): () => void {
  const vv = window.visualViewport;
  vv?.addEventListener("resize", onChange);
  document.addEventListener("focusin", onChange);
  document.addEventListener("focusout", onChange);
  return () => {
    vv?.removeEventListener("resize", onChange);
    document.removeEventListener("focusin", onChange);
    document.removeEventListener("focusout", onChange);
  };
}

/** `onScreenKeyboardOpen()`을 구독한다. 서버 렌더링·수화 첫 렌더에서는 false. */
export function useOnScreenKeyboardOpen(): boolean {
  return useSyncExternalStore(subscribe, onScreenKeyboardOpen, () => false);
}
