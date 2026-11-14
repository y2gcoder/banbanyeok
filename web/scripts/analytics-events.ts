/**
 * contracts/events.json → 웹 이벤트 TS 모듈. 순수 함수만 둔다(파일 입출력은 build-analytics-events.ts).
 * 개인정보 규칙 위반(금지 속성 이름·조각)이 있으면 생성이 실패한다.
 */

type RawProperty = {
  name: string;
  type: "string" | "integer" | "boolean" | "enum";
  required: boolean;
  enum?: string[];
  min?: number;
  max?: number;
};

type RawEvent = { name: string; source: "client" | "server" | "client_or_server"; properties: RawProperty[] };

export type EventsDocument = {
  schemaVersion: number;
  privacy: { forbiddenPropertyNames: string[]; forbiddenNameFragments: string[] };
  commonProperties: RawProperty[];
  events: RawEvent[];
};

/** 금지된 속성 이름·조각을 쓴 곳("이벤트.속성")을 모두 돌려준다. 비어 있어야 한다. */
export function privacyViolations(doc: EventsDocument): string[] {
  const { forbiddenPropertyNames, forbiddenNameFragments } = doc.privacy;
  const found: string[] = [];
  const check = (owner: string, property: RawProperty) => {
    if (forbiddenPropertyNames.includes(property.name)) {
      found.push(`${owner}.${property.name}: 금지된 속성 이름`);
    }
    const fragment = forbiddenNameFragments.find((part) => property.name.includes(part));
    if (fragment) found.push(`${owner}.${property.name}: 금지된 이름 조각 "${fragment}"`);
  };
  for (const property of doc.commonProperties) check("(공통)", property);
  for (const event of doc.events) {
    for (const property of event.properties) check(event.name, property);
  }
  return found;
}

const quote = (value: string) => JSON.stringify(value);

function specOf(property: RawProperty): string {
  const parts = [`type: ${quote(property.type)}`, `required: ${property.required}`];
  if (property.type === "enum") parts.push(`values: [${(property.enum ?? []).map(quote).join(", ")}]`);
  if (property.min !== undefined) parts.push(`min: ${property.min}`);
  if (property.max !== undefined) parts.push(`max: ${property.max}`);
  return `{ ${parts.join(", ")} }`;
}

function tsTypeOf(property: RawProperty): string {
  switch (property.type) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "integer":
      return "number";
    case "enum":
      return (property.enum ?? []).map(quote).join(" | ");
  }
}

function interfaceBody(properties: RawProperty[]): string {
  return properties.map((p) => `${p.name}${p.required ? "" : "?"}: ${tsTypeOf(p)};`).join("\n");
}

function specTable(properties: RawProperty[]): string {
  return properties.map((p) => `${p.name}: ${specOf(p)},`).join("\n");
}

/** 웹이 보낼 수 있는 이벤트(서버 전용은 제외). */
function clientEvents(doc: EventsDocument): RawEvent[] {
  return doc.events.filter((event) => event.source !== "server");
}

export function buildEventsModule(doc: EventsDocument): string {
  const violations = privacyViolations(doc);
  if (violations.length > 0) {
    throw new Error(`contracts/events.json이 개인정보 규칙을 어겼습니다:\n${violations.join("\n")}`);
  }
  const events = clientEvents(doc);
  return `// 생성 파일: contracts/events.json에서 만든다(pnpm gen:events). 직접 고치지 않는다.
export const EVENTS_SCHEMA_VERSION = ${doc.schemaVersion};

export type PropertySpec =
  | { readonly type: "string"; readonly required: boolean }
  | { readonly type: "boolean"; readonly required: boolean }
  | { readonly type: "integer"; readonly required: boolean; readonly min?: number; readonly max?: number }
  | { readonly type: "enum"; readonly required: boolean; readonly values: readonly string[] };

/** 어떤 이벤트에도 넣지 않는 속성 이름과 이름 조각. */
export const FORBIDDEN_PROPERTY_NAMES: readonly string[] = ${JSON.stringify(doc.privacy.forbiddenPropertyNames)};
export const FORBIDDEN_NAME_FRAGMENTS: readonly string[] = ${JSON.stringify(doc.privacy.forbiddenNameFragments)};

/** 모든 이벤트에 붙는 공통 속성. */
export interface CommonProperties {
${interfaceBody(doc.commonProperties)}
}

export const COMMON_PROPERTY_SPECS = {
${specTable(doc.commonProperties)}
} as const satisfies Record<keyof CommonProperties, PropertySpec>;

/** 웹이 보내는 이벤트별 속성(서버 전용 이벤트는 없다). */
export interface EventProperties {
${events.map((event) => `${event.name}: {\n${interfaceBody(event.properties)}\n};`).join("\n")}
}

export type EventName = keyof EventProperties;

export const EVENT_SPECS = {
${events.map((event) => `${event.name}: {\n${specTable(event.properties)}\n},`).join("\n")}
} as const satisfies { readonly [N in EventName]: Record<keyof EventProperties[N], PropertySpec> };
`;
}
