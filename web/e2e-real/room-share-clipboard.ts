import { expect, type Page } from "@playwright/test";

export const ROOM_PREVIEW_URL = /\/api\/v1\/rooms\/[0-9a-hjkmnp-tv-z]{10}\/preview(?:\?.*)?$/;

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
const clearClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.writeText(""));
const copyButton = (page: Page) => page.getByRole("button", { name: /^링크(를)? 복사/ });

export async function waitForRoomPreview(page: Page, roomId?: string): Promise<number> {
  const response = await page.waitForResponse(
    (r) =>
      r.ok() &&
      r.request().method() === "GET" &&
      ROOM_PREVIEW_URL.test(r.url()) &&
      (roomId === undefined || new URL(r.url()).pathname === `/api/v1/rooms/${roomId}/preview`),
  );
  const version: unknown = (await response.json()).room?.shareVersion;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 1) {
    throw new Error("방 미리보기 응답에 유효한 공유 번호가 없어요");
  }
  return version;
}

/** 미리보기를 보류한 동안에도 버튼을 한 번 누르면 기본 초대 링크가 복사된다. */
export async function expectInviteLink(page: Page, roomId: string): Promise<void> {
  await clearClipboard(page);
  await copyButton(page).click();
  await expect.poll(() => clipboard(page)).toBe(new URL(`/r/${roomId}`, page.url()).href);
}

/** 응답 뒤 React가 바꾼 링크는 클립보드 결과로 확인한다. 모으는 중의 버튼 이름은 준비 전후에 같다. */
export async function copyVersionedRoomLink(page: Page, roomId: string, version?: number): Promise<URL> {
  await clearClipboard(page);
  const suffix = version === undefined ? /\?sv=\d+&pv=\d+$/ : new RegExp(`\\?sv=${version}&pv=\\d+$`);
  let copied = "";
  await expect
    .poll(async () => {
      await copyButton(page).click();
      copied = await clipboard(page);
      return copied;
    })
    .toMatch(suffix);
  const link = new URL(copied);
  expect(link.origin).toBe(new URL(page.url()).origin);
  expect(link.pathname).toBe(`/r/${roomId}`);
  expect([...link.searchParams.keys()]).toEqual(["sv", "pv"]);
  expect(link.hash).toBe("");
  return link;
}
