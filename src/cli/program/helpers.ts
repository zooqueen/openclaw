export function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parsePositiveIntOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      return undefined;
    }
    return value > 0 ? value : undefined;
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!/^[1-9]\d*$/u.test(normalized)) {
      return undefined;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isSafeInteger(parsed)) {
      return undefined;
    }
    return parsed;
  }
  return undefined;
}

export function resolveActionArgs(actionCommand?: import("commander").Command): string[] {
  if (!actionCommand) {
    return [];
  }
  const args = (actionCommand as import("commander").Command & { args?: string[] }).args;
  return Array.isArray(args) ? args : [];
}
