/** 생성된 계약 타입(schema.gen.ts)에서 화면이 쓰는 이름만 꺼낸다. */
import type { components, paths } from "./schema.gen";

type Schemas = components["schemas"];

export type Mode = Schemas["Mode"];
export type TimeSlotId = Schemas["TimeSlot"];
export type TimeBasis = Schemas["TimeBasis"];
export type RecommendResult = Schemas["Result"];
export type RecommendBody = paths["/recommend"]["post"]["requestBody"]["content"]["application/json"];
export type ApiError = Schemas["Error"];

export type Room = Schemas["Room"];
export type RoomParticipant = Schemas["Participant"];
export type RoomCreated = Schemas["RoomCreated"];
export type RoomCreateRequest = Schemas["RoomCreateRequest"];
export type RoomPatch = Schemas["RoomPatch"];
export type DecisionRequest = Schemas["DecisionRequest"];
export type RoomPreview = Schemas["RoomPreview"];
export type ParticipantInput = Schemas["ParticipantInput"];
export type OutcomeAnswer = NonNullable<
  paths["/rooms/{roomId}/outcome"]["post"]["requestBody"]
>["content"]["application/json"];
export type JoinedRoom =
  paths["/rooms/{roomId}/participants"]["post"]["responses"]["201"]["content"]["application/json"];
