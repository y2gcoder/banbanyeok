/** 역 검색 칸에 입력하고 자동완성 목록에서 고른다. 초성(ㅎㄷㅇㄱ)도 된다. */
export async function pickStation(page, field, query, option) {
  await page.getByRole("combobox", { name: field }).fill(query);
  await page.getByRole("option", { name: option }).click();
}

/** 화면이 수화되면 웹이 서버를 깨운다(/api/healthz). 그 뒤에 입력해야 next dev의 첫 수화 전에 누른 입력이 사라지지 않는다. */
export async function gotoHydrated(page, path) {
  const warmUp = page.waitForRequest((req) => req.url().endsWith("/api/healthz"));
  await page.goto(path);
  await warmUp;
}

export const ROOM_URL = /\/r\/([0-9a-hjkmnp-tv-z]{10})$/;
export const roomIdOf = (page) => new URL(page.url()).pathname.split("/").pop();
