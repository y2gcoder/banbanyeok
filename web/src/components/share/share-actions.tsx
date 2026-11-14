"use client";

import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { track } from "@/lib/analytics";

/** path는 `/s?...`. 출처는 브라우저에서 붙인다(서버 렌더링에는 window가 없다). */
type Props = { path: string; title: string; text: string };

const absolute = (path: string) => new URL(path, window.location.origin).toString();

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 공유: 시스템 공유 시트(navigator.share, 카톡을 고른다)가 기본이고, 없으면 링크 복사 대화상자를 연다.
 * 카카오 SDK 공유(앱 키 필요)는 이번 범위가 아니다.
 */
export function ShareActions({ path, title, text }: Props) {
  // 대체 대화상자에 보여 줄 링크. null이면 닫힘. 브라우저에서만 만든다.
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    track("share_clicked", { channel: "copy", link_type: "url_state" });
    const ok = await copy(absolute(path));
    setCopied(ok);
    if (!ok) setFallbackUrl(absolute(path));
  };

  const shareToKakao = async () => {
    track("share_clicked", { channel: "system", link_type: "url_state" });
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url: absolute(path) });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return; // 사용자가 닫음
      }
    }
    setFallbackUrl(absolute(path));
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={() => void shareToKakao()}
        className="h-14 rounded-xl bg-kakao text-[17px] font-bold text-kakao-ink hover:bg-[color-mix(in_oklch,var(--kakao),black_6%)]"
      >
        <MessageCircleIcon className="size-5" aria-hidden="true" />
        카톡으로 보내기
      </Button>
      <Button type="button" variant="ghost" onClick={() => void copyLink()} className="h-11 text-[15px] font-semibold">
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {copied ? "링크를 복사했어요" : "링크 복사"}
      </Button>
      <p aria-live="polite" className="sr-only">
        {copied ? "링크를 복사했어요" : ""}
      </p>
      <Dialog open={fallbackUrl !== null} onOpenChange={(open) => !open && setFallbackUrl(null)}>
        <DialogContent className="gap-4 rounded-2xl p-5">
          <DialogTitle className="text-lg font-bold">링크를 보내 주세요</DialogTitle>
          <DialogDescription className="text-[15px] text-ink-soft">
            이 기기에서는 공유 시트를 열 수 없어요. 링크를 복사해서 카톡에 붙여 넣으세요.
          </DialogDescription>
          <div className="rounded-xl border border-rule bg-platform p-3.5">
            <p className="font-bold text-ink">{title}</p>
            <p className="text-sm text-ink-soft">{text}</p>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-ink">
            링크
            <input
              readOnly
              value={fallbackUrl ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 rounded-lg border border-input bg-surface px-3 text-sm font-normal"
            />
          </label>
          <Button type="button" onClick={() => void copyLink()} className="h-12 rounded-xl text-base font-bold">
            {copied ? "복사했어요" : "링크 복사"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
