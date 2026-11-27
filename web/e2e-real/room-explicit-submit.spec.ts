import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { errors, expect, type Locator, type Page, type Request, test } from "@playwright/test";

const newName = () => `키보드${randomUUID().slice(0, 8)}`;

function roomsWith(nickname: string): number {
  // 동시에 실행하는 다른 여정과 구분되는 이 이름의 합성 데이터만 개발 DB에서 읽는다.
  if (!/^키보드[a-f0-9]{8}$/.test(nickname)) throw new Error("테스트용 이름이 아니에요.");
  const sql = `select count(distinct room_id) from participants where nickname = '${nickname}'`;
  const out = execFileSync(
    "bash",
    ["scripts/dev.sh", "db", "exec", "-T", "db", "psql", "-U", "local", "-d", "banbanyeok", "-qtAc", sql],
    { cwd: resolve(import.meta.dirname, "../.."), encoding: "utf8" },
  );
  return Number(out.trim());
}

function observeCreation(page: Page, nickname: string, path: string) {
  const creationPaths = ["/api/v1/rooms", "/api/v1/filled-rooms", "/api/v1/draw-rooms"];
  const isCreation = (request: Request) =>
    request.method() === "POST" && creationPaths.includes(new URL(request.url()).pathname);
  const posts: Request[] = [];
  page.on("request", (request) => {
    if (isCreation(request)) posts.push(request);
  });

  return {
    async noCreation(label: string, action: () => Promise<unknown>) {
      const answer = page
        .waitForResponse((response) => isCreation(response.request()), { timeout: 650 })
        .then((response) => response.status())
        .catch((error: unknown) => {
          if (error instanceof errors.TimeoutError) return null;
          throw error;
        });
      await action();
      expect({ status: await answer, posts: posts.length, rooms: roomsWith(nickname) }, label).toEqual({
        status: null,
        posts: 0,
        rooms: 0,
      });
    },
    async activate(key: string) {
      const answer = page.waitForResponse((response) => isCreation(response.request()));
      await page.getByRole("button", { name: "방 만들기" }).press(key);
      const response = await answer;
      expect(new URL(response.url()).pathname).toBe(path);
      expect(response.status()).toBe(201);
      const { roomId } = (await response.json()) as { roomId: string };
      await expect(page).toHaveURL(new RegExp(`/r/${roomId}$`));
      expect(posts).toHaveLength(1);
      expect(roomsWith(nickname)).toBe(1);
    },
  };
}

async function openHome(page: Page) {
  const warm = page.waitForRequest((request) => request.url().endsWith("/api/healthz"));
  await page.goto("/");
  await warm;
}

async function stationByEnter(field: Locator, option: Locator, query: string, station: string) {
  await field.fill(query);
  await expect(option).toBeVisible();
  await field.press("Enter");
  await expect(option).toBeHidden();
  await expect(field).toHaveValue(station);
}

test("방장이 입력: 방이 완성돼도 내 칸·요일·시간대의 Enter는 저장하지 않는다", async ({ page }) => {
  const nickname = newName();
  const creation = observeCreation(page, nickname, "/api/v1/filled-rooms");
  await openHome(page);
  await page.getByRole("tab", { name: "방장이 입력" }).click();
  await page.getByRole("textbox", { name: "1번째 사람 이름(선택)" }).fill(nickname);
  await stationByEnter(
    page.getByRole("combobox", { name: `${nickname}의 출발역` }),
    page.getByRole("option", { name: /^강남\s?2호선/ }),
    "강남역",
    "강남",
  );
  await stationByEnter(
    page.getByRole("combobox", { name: "친구1의 출발역" }),
    page.getByRole("option", { name: /^홍대입구\s?2호선/ }),
    "홍대입구역",
    "홍대입구",
  );

  const myRow = page.getByRole("radio", { name: `1번 · ${nickname}` });
  const friend = page.getByRole("radio", { name: "2번", exact: true });
  const day = page.getByRole("radio", { name: "토요일", exact: true });
  const band = page.getByRole("radio", { name: /^낮/ });
  await creation.noCreation("내 칸의 Enter", () => myRow.press("Enter"));
  await creation.noCreation("요일의 Enter", () => day.press("Enter"));
  await creation.noCreation("시간대의 Enter", () => band.press("Enter"));
  await creation.noCreation("라디오 방향키와 Space", async () => {
    await myRow.press("ArrowRight");
    await expect(friend).toBeChecked();
    await myRow.press("Space");
    await expect(myRow).toBeChecked();
  });
  await creation.noCreation("사람 더하기와 빼기 버튼의 Enter", async () => {
    await page.getByRole("button", { name: /한 명 더/ }).press("Enter");
    await expect(page.getByRole("textbox", { name: "3번째 사람 이름(선택)" })).toBeVisible();
    await page.getByRole("button", { name: "친구2 빼기" }).press("Enter");
    await expect(page.getByRole("textbox", { name: "3번째 사람 이름(선택)" })).toBeHidden();
  });

  await creation.activate("Enter");
});

test("각자 입력: 날짜·시각 등 폼 안의 Enter는 저장하지 않는다", async ({ page }) => {
  const nickname = newName();
  const creation = observeCreation(page, nickname, "/api/v1/rooms");
  await openHome(page);
  const name = page.getByRole("textbox", { name: "내 이름 (선택)" });
  await name.fill(nickname);
  await stationByEnter(
    page.getByRole("combobox", { name: "내 출발역" }),
    page.getByRole("option", { name: /^강남\s?2호선/ }),
    "강남역",
    "강남",
  );

  await creation.noCreation("이름 입력과 조합 중의 Enter", async () => {
    await name.press("Enter");
    const accepted = await name.evaluate((input) =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(accepted).toBe(true);
    await expect(name).toHaveValue(nickname);
  });
  await creation.noCreation("추천 기준의 Enter", () => page.getByRole("radio", { name: /^공평하게/ }).press("Enter"));
  const saturday = page.getByRole("radio", { name: /^이번 토요일/ });
  await creation.noCreation("날짜 칩의 Enter", async () => {
    await saturday.press("Enter");
    await saturday.press("Space");
    await expect(saturday).toBeChecked();
  });
  await creation.noCreation("시간대 칩의 Enter", () => page.getByRole("radio", { name: /^낮/ }).press("Enter"));
  await creation.noCreation("달력의 Enter", async () => {
    await page.getByLabel("날짜 선택", { exact: true }).press("Enter");
    await page.keyboard.press("Escape");
  });
  await creation.noCreation("정확한 시각 켜기 버튼의 Enter", () =>
    page.getByRole("button", { name: "+ 정확한 시각 넣기" }).press("Enter"),
  );
  const time = page.getByLabel("시각", { exact: true });
  await time.fill("18:30");
  await creation.noCreation("시각 입력의 Enter", () => time.press("Enter"));
  await expect(time).toHaveValue("18:30");
  await creation.noCreation("인원 요약과 인원 버튼의 Enter", async () => {
    await page.locator("summary").filter({ hasText: "인원 정하기" }).press("Enter");
    const count = page.getByRole("button", { name: "2명", exact: true });
    await count.press("Enter");
    await expect(count).toHaveAttribute("aria-pressed", "true");
  });

  await creation.activate("Space");
});
