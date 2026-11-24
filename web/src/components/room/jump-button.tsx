"use client";

import { ArrowDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  /** 옮겨 갈 요소의 id. */
  targetId: string;
  /** 포커스를 둘 곳: 그 요소 자체(`tabIndex={-1}`인 제목) 또는 그 안의 첫 입력 칸. */
  focus: "self" | "input";
  primary?: boolean;
  className?: string;
  children: ReactNode;
};

/**
 * 같은 화면 아래 칸으로 옮겨 가는 버튼(#168). 결과가 있는 방은 폰에서 1위를 첫 화면에 두려고 참여자 목록·참여 폼을 결과 아래로
 * 내렸으므로, 위에서 그리로 바로 가는 길을 둔다. 주소(#해시)를 바꾸지 않고 스크롤한 뒤 포커스를 옮긴다(키보드·스크린리더도 따라간다).
 */
export function JumpButton({ targetId, focus, primary = false, className, children }: Props) {
  const jump = () => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    target.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "start" });
    const focusable = focus === "self" ? target : target.querySelector<HTMLElement>("input");
    focusable?.focus({ preventScroll: true });
  };
  return (
    <Button
      type="button"
      variant={primary ? "default" : "ghost"}
      onClick={jump}
      className={cn(
        primary
          ? "h-12 rounded-xl text-[16px] font-bold"
          : "h-11 px-2 text-[14px] font-semibold text-ink-soft underline-offset-4 hover:underline",
        className,
      )}
    >
      {children}
      <ArrowDownIcon aria-hidden="true" />
    </Button>
  );
}
