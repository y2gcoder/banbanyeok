"use client";

import { CheckIcon, CopyIcon, Loader2Icon } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type RoomRef, roomHashProperty, track } from "@/lib/analytics";
import type { ShareStage } from "@/lib/room/share-copy";
import { type KakaoFeedMessage, type KakaoFeedSettings, kakaoFeedSettings, publicKakaoJsKey } from "@/lib/share/kakao";
import { type KakaoSdk, preloadKakaoShare, readyKakaoShare } from "@/lib/share/kakao-sdk";

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

const KAKAOTALK_ICON = "/icons/kakaotalk-sharing.svg";

/** 카카오톡 앱이 안 열리고 이 페이지에 머물 때 "여는 중"을 거두는 시간(ms). */
const OPENING_MS = 4000;

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
 * 공유: 빌드에 카카오 앱 키가 있고 메시지(`kakao`)를 받았으면 카카오톡 공유 API로 보낸다. 이 칸이 화면에 들어오면 SDK를 받고 내용 없는
 * 확인을 받아 두고(`preloadKakaoShare`), 누르면 그 클릭 안에서 이 메시지를 보낸다. 키가 없거나, 아직 준비 중이거나, SDK를 못 받았거나
 * 카카오가 확인을 거절했거나 SDK가 보내기를 거부하면 그 누름은 지금까지처럼 시스템 공유 시트(navigator.share, 카톡을 고른다)로, 그것도
 * 없으면 링크 복사 대화상자로 간다. 기다려서 보내지 않는다(iOS가 늦은 카카오톡 열기와 공유 시트를 막는다). 준비가 실패했으면 그 누름이
 * 다음 누름을 위해 다시 준비한다.
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
  // 카카오 버튼 상태. sendDefault가 돌아온 뒤 카카오톡이 열릴 때까지는 SDK 확인 요청과 앱 전환 때문에 화면이 그대로라서, 그 사이 눌림을 알리고 다시 누름을 막는다.
  const [kakaoState, setKakaoState] = useState<"idle" | "opening">("idle");
  const opening = kakaoState === "opening";
  const kakaoKey = kakao ? publicKakaoJsKey() : null;
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = area.current;
    if (!kakaoKey || !element) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      preloadKakaoShare(kakaoKey);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [kakaoKey]);

  useEffect(() => {
    if (!opening) return;
    const done = () => setKakaoState("idle");
    const timer = window.setTimeout(done, OPENING_MS);
    // 카카오톡으로 갔다가 돌아오면 숨겨졌던 페이지가 다시 보인다. bfcache로 복원되면 pageshow만 온다.
    let hidden = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hidden = true;
      else if (hidden) done();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) done();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [opening]);

  const copyLink = async () => {
    track("share_clicked", { channel: "copy", link_type: linkType, ...roomProperty });
    const ok = await copy(absolute(path));
    setCopied(ok);
    if (!ok) setFallbackUrl(absolute(path));
  };

  const kakaoSettings = (): KakaoFeedSettings | null =>
    kakao && kakaoKey ? kakaoFeedSettings(kakao, window.location.origin) : null;

  const sendWithKakao = (sdk: KakaoSdk, settings: KakaoFeedSettings): boolean => {
    try {
      sdk.Share.sendDefault(settings);
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

  const shareToKakao = () => {
    if (opening) return;
    const settings = kakaoSettings();
    const sdk = readyKakaoShare();
    if (settings && sdk && sendWithKakao(sdk, settings)) {
      setKakaoState("opening");
      return;
    }
    if (kakaoKey) preloadKakaoShare(kakaoKey);
    void systemShare();
  };

  return (
    <div ref={area} className="flex flex-col gap-2">
      <Button
        type="button"
        onClick={shareToKakao}
        aria-busy={opening || undefined}
        className="h-14 rounded-xl bg-kakao text-[17px] font-bold text-kakao-ink transition-transform hover:bg-[color-mix(in_oklch,var(--kakao),black_6%)] active:scale-[0.98] active:bg-[color-mix(in_oklch,var(--kakao),black_10%)]"
      >
        {opening ? (
          <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <Image src={KAKAOTALK_ICON} alt="" aria-hidden="true" width={34} height={35} className="h-auto w-7" />
        )}
        {opening ? "카카오톡 여는 중…" : button}
      </Button>
      <Button type="button" variant="ghost" onClick={() => void copyLink()} className="h-11 text-[15px] font-semibold">
        {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
        {copied ? "링크 복사됨" : "링크 복사"}
      </Button>
      <p aria-live="polite" className="sr-only">
        {copied ? "링크 복사됨" : opening ? "카카오톡 여는 중" : ""}
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
            {copied ? "복사됨" : "링크 복사"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
