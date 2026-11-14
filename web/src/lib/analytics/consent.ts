/**
 * 통계 동의 상태(옵트인). 동의하기 전에는 PostHog를 불러오지도 초기화하지도 않는다.
 *
 * - 저장: 이 기기의 localStorage에 `{ v, status, at }`. `v`(CONSENT_VERSION)가 바뀌면 이전 선택은 무효이고 다시 묻는다
 *   (방침·수집 항목이 달라져 다시 동의받아야 할 때 올린다). `at`은 선택한 시각(입증용, 기기에만 있다).
 * - 아무것도 고르지 않으면 미동의다("unset"은 수집하지 않는다).
 * - 브라우저의 추적 거부 신호(DNT·GPC)가 있으면 묻지 않고 미동의로 둔다.
 */
export const CONSENT_KEY = "bby.analytics.consent";
export const CONSENT_VERSION = 1;

export type StoredChoice = "granted" | "denied" | "unset";

/** 화면이 보는 상태. `unavailable`=이 빌드는 통계 키가 없어 모으지 않음, `browser-declined`=DNT/GPC. */
export type ConsentState = "granted" | "denied" | "ask" | "browser-declined" | "unavailable";

const CHANGED = "bby:analytics-consent";

export function readChoice(): StoredChoice {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return "unset";
    const record: unknown = JSON.parse(raw);
    if (typeof record !== "object" || record === null) return "unset";
    const { v, status } = record as { v?: unknown; status?: unknown };
    if (v !== CONSENT_VERSION) return "unset";
    return status === "granted" || status === "denied" ? status : "unset";
  } catch {
    return "unset"; // 저장소를 읽을 수 없으면 동의하지 않은 것으로 본다.
  }
}

/** 선택을 저장하고 같은 탭의 구독자에게 알린다(다른 탭은 storage 이벤트로 안다). */
export function writeChoice(status: "granted" | "denied", now: Date = new Date()): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION, status, at: now.toISOString() }));
  } catch {
    // 저장할 수 없으면 다음 방문에 다시 묻는다. 이번 탭에서는 아래 알림으로 반영한다.
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function subscribeConsent(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** 화면 상태. `available`=통계 키가 설정된 빌드인지, `declined`=브라우저 추적 거부 신호. */
export function consentState(available: boolean, declined: boolean): ConsentState {
  if (!available) return "unavailable";
  if (declined) return "browser-declined";
  const choice = readChoice();
  return choice === "unset" ? "ask" : choice;
}
