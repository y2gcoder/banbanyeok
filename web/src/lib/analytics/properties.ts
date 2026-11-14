/**
 * 이벤트 속성 검증. contracts/events.json(생성된 events.gen.ts)에 없는 속성, 금지된 이름, 잘못된 값이 하나라도 있으면
 * 이벤트를 보내지 않는다. 출발역·별칭이 속성으로 새는 것을 타입(컴파일)과 이 검사(실행) 두 겹으로 막는다.
 */
import {
  COMMON_PROPERTY_SPECS,
  type CommonProperties,
  EVENT_SPECS,
  type EventName,
  type EventProperties,
  FORBIDDEN_NAME_FRAGMENTS,
  FORBIDDEN_PROPERTY_NAMES,
  type PropertySpec,
} from "./events.gen";

const MAX_STRING_LENGTH = 64;

type Specs = Readonly<Record<string, PropertySpec>>;
type Values = object;

export function isForbiddenPropertyName(name: string): boolean {
  return FORBIDDEN_PROPERTY_NAMES.includes(name) || FORBIDDEN_NAME_FRAGMENTS.some((part) => name.includes(part));
}

function valueProblem(spec: PropertySpec, value: unknown): string | null {
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "boolean이어야 합니다";
    case "string":
      if (typeof value !== "string" || value.length === 0) return "비어 있지 않은 문자열이어야 합니다";
      return value.length <= MAX_STRING_LENGTH ? null : `${MAX_STRING_LENGTH}자 이하여야 합니다`;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return "정수여야 합니다";
      if (spec.min !== undefined && value < spec.min) return `${spec.min} 이상이어야 합니다`;
      if (spec.max !== undefined && value > spec.max) return `${spec.max} 이하여야 합니다`;
      return null;
    case "enum":
      return typeof value === "string" && spec.values.includes(value)
        ? null
        : `허용 값이 아닙니다(${spec.values.join(", ")})`;
  }
}

/** 문제 목록(비어 있으면 통과). */
export function propertyProblems(specs: Specs, values: Values): string[] {
  const problems: string[] = [];
  const given = values as Readonly<Record<string, unknown>>;
  for (const [name, value] of Object.entries(given)) {
    if (value === undefined) continue;
    const spec = specs[name];
    if (isForbiddenPropertyName(name)) problems.push(`${name}: 금지된 속성입니다`);
    else if (!spec) problems.push(`${name}: contracts/events.json에 없는 속성입니다`);
    else {
      const problem = valueProblem(spec, value);
      if (problem) problems.push(`${name}: ${problem}`);
    }
  }
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.required && given[name] === undefined) problems.push(`${name}: 필수 속성이 없습니다`);
  }
  return problems;
}

export class AnalyticsContractError extends Error {
  constructor(
    readonly event: string,
    readonly problems: readonly string[],
  ) {
    super(`이벤트 ${event}가 계약을 어겼습니다: ${problems.join("; ")}`);
    this.name = "AnalyticsContractError";
  }
}

/** 이벤트 이름·속성·공통 속성을 검증해 PostHog로 보낼 속성 묶음을 만든다. 어기면 AnalyticsContractError. */
export function buildEventProperties<N extends EventName>(
  name: N,
  properties: EventProperties[N],
  common: CommonProperties,
): Record<string, unknown> {
  const specs = EVENT_SPECS[name] as Specs | undefined;
  if (!specs) throw new AnalyticsContractError(name, ["contracts/events.json에 없는 이벤트입니다"]);
  const problems = [
    ...propertyProblems(specs, properties),
    ...propertyProblems(COMMON_PROPERTY_SPECS, common).map((problem) => `(공통) ${problem}`),
  ];
  if (problems.length > 0) throw new AnalyticsContractError(name, problems);
  return { ...properties, ...common };
}
