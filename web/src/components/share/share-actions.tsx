"use client";

import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import { type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type RoomRef, roomHashProperty, track } from "@/lib/analytics";
import type { ShareStage } from "@/lib/room/share-copy";
import { type KakaoFeedMessage, kakaoFeedSettings, publicKakaoJsKey } from "@/lib/share/kakao";
import { type KakaoSdk, preloadKakaoSdk, readyKakaoSdk, waitForKakaoSdk } from "@/lib/share/kakao-sdk";

/**
 * path는 `/s?...`(혼자 입력한 결과) 또는 `/r/<방 ID>?sv=<n>`(방). 출처는 브라우저에서 붙인다(서버 렌더링에는 window가 없다).
 * `linkType`은 통계 이벤트의 링크 종류다. 방 링크라도 방 ID는 통계에 보내지 않는다.
 */
type Props = {
  path: string;
  title: string;
  text: string;
  /** 공유 버튼 이름. 기본 "카톡으로 보내기". */
  button?: string;
  linkType?: "url_state" | "room";
  /** 방 링크면 그 방과 링크 미리보기 단계. 통계에는 서버가 준 `room_hash`와 단계만 간다. */
  room?: RoomRef & { stage: ShareStage };
  /** 카카오톡 공유 API로 보낼 메시지. 빌드에 카카오 앱 키가 없으면 쓰지 않는다. */
  kakao?: KakaoFeedMessage;
};

/**
 * 첫 누름에 SDK를 기다리는 한도. 모바일은 SDK 자신도 카카오 확인 요청을 기다린 뒤 카카오톡을 열므로 기다려도 되고, PC 공유 창(팝업)은
 * 브라우저가 누른 직후 몇 초 동안만 열어 준다. 못 받으면 그 누름은 시스템 공유로 간다.
 */
const KAKAO_WAIT_MS = 3000;

const isActivationKey = (event: KeyboardEvent) => event.key === "Enter" || event.key === " ";

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
 * 공유: 빌드에 카카오 앱 키가 있고 메시지(`kakao`)를 받았으면 카카오톡 공유 API로 보낸다. SDK는 버튼을 누르기 시작할 때 처음 받고,
 * 누른 순간 준비돼 있으면 바로, 아니면 `KAKAO_WAIT_MS`까지 기다렸다 보낸다. 키가 없거나 SDK를 못 받거나 SDK가 거절하면 지금까지처럼
 * 시스템 공유 시트(navigator.share, 카톡을 고른다)로, 그것도 없으면 링크 복사 대화상자로 간다.
 */
export function ShareActions({
  path,
  title,
  text,
  button = "카톡으로 보내기",
  linkType = "url_state",
  room,
  kakao,
}: Props) {
  const roomProperty = linkType === "room" && room ? { ...roomHashProperty(room), room_stage: room.stage } : {};
  // 대체 대화상자에 보여 줄 링크. null이면 닫힘. 브라우저에서만 만든다.
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const kakaoKey = kakao ? publicKakaoJsKey() : null;
  const sending = useRef(false);

  const copyLink = async () => {
    track("share_clicked", { channel: "copy", link_type: linkType, ...roomProperty });
    const ok = await copy(absolute(path));
    setCopied(ok);
    if (!ok) setFallbackUrl(absolute(path));
  };

  const prepareKakao = () => {
    if (kakaoKey) preloadKakaoSdk(kakaoKey);
  };

  const sendWithKakao = (sdk: KakaoSdk, message: KakaoFeedMessage): boolean => {
    try {
      sdk.Share.sendDefault(kakaoFeedSettings(message, window.location.origin));
    } catch {
      return false;
    }
    track("share_clicked", { channel: "kakao", link_type: linkType, ...roomProperty });
    return true;
  };

  const systemShare = async () => {
    track("share_clicked", { channel: "system", link_type: linkType, ...roomProperty });
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

  const shareToKakao = async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      if (kakao && kakaoKey) {
        const sdk = readyKakaoSdk() ?? (await waitForKakaoSdk(kakaoKey, KAKAO_WAIT_MS));
        if (sdk && sendWithKakao(sdk, kakao)) return;
      }
      await systemShare();
    } finally {
      sending.current = false;
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        onPointerDown={prepareKakao}
        onKeyDown={(event) => isActivationKey(event) && prepareKakao()}
        onClick={() => void shareToKakao()}
        className="h-14 rounded-xl bg-kakao text-[17px] font-bold text-kakao-ink hover:bg-[color-mix(in_oklch,var(--kakao),black_6%)]"
      >
        <MessageCircleIcon className="size-5" aria-hidden="true" />
        {button}
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
              className="h-11 rounded-lg border border-input bg-surface px-3 text-[16px] font-normal"
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
