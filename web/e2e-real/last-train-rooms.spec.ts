import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

/**
 * 방의 "집에 가는 막차"(#62) e2e: 실제 서버의 막차 값으로, 약속 날짜·시각에 따라 달라지는 화면을 본다(#83 검토).
 * 방은 API로 만들고(강남·부천, dev 산출물에서 1위 신도림) 참여하지 않은 사람의 화면으로 연다: 누구에게나 같은 공용 화면이다.
 */
const GANGNAM = "k3a";
const BUCHEON = "ry7";

type Person = { originCode: string; hidden?: boolean };

async function createRoom(
  request: APIRequestContext,
  meeting: { meetingDate?: string; meetingTime?: string },
  people: [Person, Person] = [{ originCode: GANGNAM }, { originCode: BUCHEON }],
): Promise<string> {
  const [host, friend] = people;
  const created = await request.post("/api/v1/rooms", {
    data: { mode: "fair", ...meeting, host: { originCode: host.originCode, hidden: host.hidden === true } },
  });
  expect(created.status()).toBe(201);
  const { roomId } = (await created.json()) as { roomId: string };
  const joined = await request.post(`/api/v1/rooms/${roomId}/participants`, {
    data: { originCode: friend.originCode, hidden: friend.hidden === true },
  });
  expect(joined.status()).toBe(201);
  return roomId;
}

/** 서울 기준 내일 이후의 첫 토요일(`YYYY-MM-DD`). 약속일은 오늘부터 30일 안이어야 한다. */
function nextSaturday(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((6 - date.getUTCDay() + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
}

async function openLastTrain(page: Page, roomId: string) {
  await page.goto(`/r/${roomId}`);
  const section = page.getByRole("article").first().getByRole("region", { name: "집에 가는 막차" });
  await expect(section).toBeVisible();
  return section;
}

test("새벽 약속: 02:59는 전날 운행일이라 약속보다 먼저 떠나는 열차를 귀가 시각으로 보이지 않고, 03:00은 그날 밤 막차를 보인다", async ({
  page,
  request,
}) => {
  const saturday = nextSaturday();
  const [, month, day] = saturday.split("-").map(Number);

  // 02:59: 전날 운행일의 열차는 모두 03:00 전에 떠난다. 시각이 있는 줄은 전부 "약속 전"이어야 한다.
  const early = await openLastTrain(page, await createRoom(request, { meetingDate: saturday, meetingTime: "02:59" }));
  const gone = early.getByRole("listitem").filter({ hasText: /막차는 약속 전에 떠나요\.|약속 시각보다 일러요\./ });
  await expect(gone.first()).toBeVisible();
  // 강남 방면 2호선 직행(전날 운행일의 자정을 넘긴 열차)은 약속일 새벽에 떠난다: 실제 날짜로 말한다.
  await expect(
    early.getByText(new RegExp(`^${month}월 ${day}일 0\\d:\\d\\d 막차는 약속 전에 떠나요\\.$`)),
  ).toBeVisible();
  await expect(early.getByText("약속 전에 막차가 떠나는 분이 있어요.")).toBeVisible();
  await expect(early).not.toContainText(/다음 날|나서야 해요|출발하세요|가장 일러요/);
  await expect(early).not.toContainText(/막차\d\d:\d\d|늦어도\d\d:\d\d/);
  // 지도 앱 버튼은 남는다.
  await expect(gone.first().getByRole("link", { name: /지도 앱에서 막차 확인하기$/ })).toBeVisible();

  // 03:00: 그날(토요일) 운행일이다. 밤의 막차를 그대로 보인다.
  const after = await openLastTrain(page, await createRoom(request, { meetingDate: saturday, meetingTime: "03:00" }));
  await expect(after).toContainText(/막차\d\d:\d\d|늦어도\d\d:\d\d/);
  await expect(after).not.toContainText(/약속 전|약속 시각보다/);
  await expect(after.getByText(/전에 나서야 해요$|가장 일러요\./)).toBeVisible();
});

test("약속 날짜가 없는 방: 이유를 먼저 말하고 요일·일부 노선·'계산했어요'는 보이지 않는다", async ({
  page,
  request,
}) => {
  const section = await openLastTrain(page, await createRoom(request, {}));
  await expect(
    section.getByText("약속 날짜가 없어 요일을 알 수 없어요. 요일마다 막차가 달라 보여 드리지 못해요."),
  ).toHaveCount(1);
  await expect(section.getByRole("listitem")).toHaveCount(2);
  await expect(section.getByText(/^시간표 수집 기준 \d{4}년 \d{1,2}월 \d{1,2}일\.$/)).toBeVisible();
  await expect(section).not.toContainText(/평일|토요일|일부 노선|계산했어요|나서야|\d\d:\d\d/);
});

test("모두 출발역을 숨긴 방: 본인이 아닌 사람에게는 '본인 화면에서만 보여요'만 보인다", async ({ page, request }) => {
  const roomId = await createRoom(request, { meetingDate: nextSaturday(), meetingTime: "19:00" }, [
    { originCode: GANGNAM, hidden: true },
    { originCode: BUCHEON, hidden: true },
  ]);
  const section = await openLastTrain(page, roomId);
  await expect(section.getByText("출발역을 숨긴 분의 막차는 본인 화면에서만 보여요.")).toBeVisible();
  await expect(section.getByRole("listitem")).toHaveCount(0);
  await expect(section).not.toContainText(/강남|부천|\d\d:\d\d|수집 기준|일부 노선/);
});
