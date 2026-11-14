/**
 * 통계 자리(P7에서 PostHog로 채운다). 이벤트 이름·속성은 contracts/events.json을 따른다.
 * 출발역은 이벤트에 넣지 않는다(docs/01-synthesis.md). 지금은 아무것도 보내지 않는다.
 */
export function track(_event: string, _properties?: Record<string, string | number | boolean>): void {}
