/** 이벤트 속성에 보내는 구간 값. 정확한 값 대신 구간만 보낸다(contracts/events.json의 enum과 같다). */
import type { EventProperties } from "./events.gen";

type MinutesBucket = NonNullable<EventProperties["result_viewed"]["max_minutes_bucket"]>;
type ResponseBucket = NonNullable<EventProperties["result_viewed"]["response_time_bucket"]>;

/** 1위 후보의 최장 소요시간(분) 구간. 경계는 아래쪽 포함: 15분은 "15-30". */
export function maxMinutesBucket(minutes: number): MinutesBucket {
  if (minutes < 15) return "0-15";
  if (minutes < 30) return "15-30";
  if (minutes < 45) return "30-45";
  if (minutes < 60) return "45-60";
  if (minutes < 90) return "60-90";
  return "90+";
}

/** 추천 서버 응답 시간(밀리초) 구간. 3초 넘는 구간은 콜드스타트를 가려내는 용도다. */
export function responseTimeBucket(milliseconds: number): ResponseBucket {
  if (milliseconds < 300) return "0-300";
  if (milliseconds < 1000) return "300-1000";
  if (milliseconds < 3000) return "1000-3000";
  return "3000+";
}
