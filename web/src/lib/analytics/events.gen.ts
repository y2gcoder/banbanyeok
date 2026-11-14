// 생성 파일: contracts/events.json에서 만든다(pnpm gen:events). 직접 고치지 않는다.
export const EVENTS_SCHEMA_VERSION = 2;

export type PropertySpec =
  | { readonly type: "string"; readonly required: boolean }
  | { readonly type: "boolean"; readonly required: boolean }
  | { readonly type: "integer"; readonly required: boolean; readonly min?: number; readonly max?: number }
  | { readonly type: "enum"; readonly required: boolean; readonly values: readonly string[] };

/** 어떤 이벤트에도 넣지 않는 속성 이름과 이름 조각. */
export const FORBIDDEN_PROPERTY_NAMES: readonly string[] = [
  "origin",
  "origins",
  "origin_code",
  "origin_codes",
  "origin_station",
  "departure_station",
  "nickname",
  "nicknames",
  "alias",
  "aliases",
  "room_id",
  "participant_id",
  "host_token",
  "participant_token",
  "device_token",
  "lat",
  "lng",
  "address",
];
export const FORBIDDEN_NAME_FRAGMENTS: readonly string[] = ["origin", "nickname", "room_id", "token"];

/** 모든 이벤트에 붙는 공통 속성. */
export interface CommonProperties {
  platform: "web" | "ios" | "android" | "server";
  app_version: string;
  data_version?: string;
  anon_user_id?: string;
}

export const COMMON_PROPERTY_SPECS = {
  platform: { type: "enum", required: true, values: ["web", "ios", "android", "server"] },
  app_version: { type: "string", required: true },
  data_version: { type: "string", required: false },
  anon_user_id: { type: "string", required: false },
} as const satisfies Record<keyof CommonProperties, PropertySpec>;

/** 웹이 보내는 이벤트별 속성(서버 전용 이벤트는 없다). */
export interface EventProperties {
  input_completed: {
    participant_count: number;
    has_custom_name: boolean;
    mode: "fair" | "fast" | "favor";
    input_ms: number;
  };
  result_viewed: {
    participant_count: number;
    mode: "fair" | "fast" | "favor";
    max_minutes_bucket?: "0-15" | "15-30" | "30-45" | "45-60" | "60-90" | "90+";
    candidate_count: number;
    response_time_bucket?: "0-300" | "300-1000" | "1000-3000" | "3000+";
    top1_station_code?: string;
    room_hash?: string;
  };
  mode_switched: {
    from_mode: "fair" | "fast" | "favor";
    to_mode: "fair" | "fast" | "favor";
    favor_used: boolean;
  };
  share_clicked: {
    channel: "kakao" | "copy" | "system";
    link_type: "url_state" | "room";
    room_hash?: string;
  };
  link_opened: {
    link_type: "url_state" | "room";
    is_first_visit: boolean;
    referrer_kind: "direct" | "kakao" | "search" | "other";
    room_hash?: string;
  };
  link_person_selected: {
    participant_count: number;
    person_position: number;
  };
  map_app_opened: {
    app: "kakao" | "naver";
    rank: number;
  };
  station_chosen: {
    rank: number;
    meeting_station_code: string;
    mode: "fair" | "fast" | "favor";
    participant_count: number;
    link_variant: "creator" | "received";
  };
  seo_to_input_clicked: {
    page_kind: "pair" | "hub";
  };
  outcome_answered: {
    outcome: "top1" | "top3" | "other" | "none";
    meeting_station_code?: string;
    days_since_result: number;
    room_hash?: string;
  };
  analytics_consent_changed: {
    granted: boolean;
  };
}

export type EventName = keyof EventProperties;

export const EVENT_SPECS = {
  input_completed: {
    participant_count: { type: "integer", required: true, min: 2, max: 4 },
    has_custom_name: { type: "boolean", required: true },
    mode: { type: "enum", required: true, values: ["fair", "fast", "favor"] },
    input_ms: { type: "integer", required: true, min: 0 },
  },
  result_viewed: {
    participant_count: { type: "integer", required: true, min: 2, max: 4 },
    mode: { type: "enum", required: true, values: ["fair", "fast", "favor"] },
    max_minutes_bucket: { type: "enum", required: false, values: ["0-15", "15-30", "30-45", "45-60", "60-90", "90+"] },
    candidate_count: { type: "integer", required: true, min: 0 },
    response_time_bucket: { type: "enum", required: false, values: ["0-300", "300-1000", "1000-3000", "3000+"] },
    top1_station_code: { type: "string", required: false },
    room_hash: { type: "string", required: false },
  },
  mode_switched: {
    from_mode: { type: "enum", required: true, values: ["fair", "fast", "favor"] },
    to_mode: { type: "enum", required: true, values: ["fair", "fast", "favor"] },
    favor_used: { type: "boolean", required: true },
  },
  share_clicked: {
    channel: { type: "enum", required: true, values: ["kakao", "copy", "system"] },
    link_type: { type: "enum", required: true, values: ["url_state", "room"] },
    room_hash: { type: "string", required: false },
  },
  link_opened: {
    link_type: { type: "enum", required: true, values: ["url_state", "room"] },
    is_first_visit: { type: "boolean", required: true },
    referrer_kind: { type: "enum", required: true, values: ["direct", "kakao", "search", "other"] },
    room_hash: { type: "string", required: false },
  },
  link_person_selected: {
    participant_count: { type: "integer", required: true, min: 2, max: 4 },
    person_position: { type: "integer", required: true, min: 0, max: 3 },
  },
  map_app_opened: {
    app: { type: "enum", required: true, values: ["kakao", "naver"] },
    rank: { type: "integer", required: true, min: 1, max: 3 },
  },
  station_chosen: {
    rank: { type: "integer", required: true, min: 1, max: 3 },
    meeting_station_code: { type: "string", required: true },
    mode: { type: "enum", required: true, values: ["fair", "fast", "favor"] },
    participant_count: { type: "integer", required: true, min: 2, max: 4 },
    link_variant: { type: "enum", required: true, values: ["creator", "received"] },
  },
  seo_to_input_clicked: {
    page_kind: { type: "enum", required: true, values: ["pair", "hub"] },
  },
  outcome_answered: {
    outcome: { type: "enum", required: true, values: ["top1", "top3", "other", "none"] },
    meeting_station_code: { type: "string", required: false },
    days_since_result: { type: "integer", required: true, min: 0 },
    room_hash: { type: "string", required: false },
  },
  analytics_consent_changed: {
    granted: { type: "boolean", required: true },
  },
} as const satisfies { readonly [N in EventName]: Record<keyof EventProperties[N], PropertySpec> };
