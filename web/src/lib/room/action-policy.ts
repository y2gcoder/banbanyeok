/**
 * 방 화면의 쓰기 동작이 실패했을 때 화면이 할 일. 순수 함수라 오류 종류 × 동작 표로 검증한다(`action-policy.test.ts`).
 * 문구 자체는 `errors.ts`의 `roomErrorMessage`가 만든다. 여기서는 "다시 불러오나", "화면의 알림 칸에 올리나"만 정한다.
 */
import { isRoomGone, isStaleRoom, isTokenRejected } from "./errors";

/** 방 화면에서 서버에 쓰는 동작. `decide`는 만날 역 정하기·풀기(`useRoomDecision`)다. */
export type RoomAction = "join" | "edit" | "leave" | "kick" | "lock" | "remove" | "decide";

export type ErrorPolicy = {
  /** 방·결과·미리보기를 다시 불러온다(화면이 가진 방 상태가 오래됐거나 이 기기의 토큰이 통하지 않을 때). */
  refresh: boolean;
  /** 화면의 알림 칸(`actionError`·결정 알림)에 오류 문구를 올린다. 참여·수정은 폼이 자기 mutation 오류를 직접 보여 주므로 올리지 않는다. */
  report: boolean;
};

export function errorPolicy(action: RoomAction, error: unknown): ErrorPolicy {
  switch (action) {
    // 잠김·정원 초과·사라진 방·그사이 바뀐 방이면 화면의 방 상태가 오래된 것이다.
    case "join":
      return { refresh: isStaleRoom(error), report: false };
    // 토큰이 죽었거나(내보내짐) 방이 없어졌으면 "내 항목" 표시가 틀렸으니 다시 불러온다.
    case "edit":
      return { refresh: isTokenRejected(error) || isRoomGone(error), report: false };
    case "leave":
    case "kick":
    case "lock":
    case "remove":
      return { refresh: isRoomGone(error), report: true };
    case "decide":
      return { refresh: isStaleRoom(error) || isTokenRejected(error), report: true };
  }
}
