import type { KeyboardEvent } from "react";

/** 이름·검색 칸에서 누른 Enter로 방이 만들어지지 않게 한다. 선택 칸 자체의 키 동작과 제출 버튼은 그대로 쓴다. */
export function preventImplicitRoomSubmit(event: KeyboardEvent<HTMLFormElement>) {
  if (
    event.key === "Enter" &&
    !event.nativeEvent.isComposing &&
    event.target instanceof HTMLInputElement &&
    event.target.type === "text"
  ) {
    event.preventDefault();
  }
}
