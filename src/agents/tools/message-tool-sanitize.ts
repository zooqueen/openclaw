import { stripReasoningTagsFromText } from "../../shared/text/reasoning-tags.js";

export function sanitizeMessageToolText(text: string): string {
  const stripped = stripReasoningTagsFromText(text);
  const lines = stripped.split(/\r?\n/u);
  const prefix = lines[0]?.trim();
  if (prefix !== "Reasoning:" && !/^Thinking\.{0,3}$/u.test(prefix ?? "")) {
    return stripped;
  }
  if (/^Thinking\.{0,3}$/u.test(prefix ?? "")) {
    const firstBodyLine = lines.slice(1).find((line) => line.trim());
    const trimmedBodyLine = firstBodyLine?.trim() ?? "";
    if (
      !trimmedBodyLine ||
      !(
        trimmedBodyLine.startsWith("_") &&
        trimmedBodyLine.endsWith("_") &&
        trimmedBodyLine.length >= 2
      )
    ) {
      return stripped;
    }
  }

  let index = 1;
  while (index < lines.length) {
    const trimmed = lines[index]?.trim() ?? "";
    if (!trimmed || (trimmed.startsWith("_") && trimmed.endsWith("_") && trimmed.length >= 2)) {
      index += 1;
      continue;
    }
    break;
  }
  return lines.slice(index).join("\n").trim();
}

export function sanitizeMessageToolPresentationTextFields(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const presentation = { ...(value as Record<string, unknown>) };
  if (typeof presentation.title === "string") {
    presentation.title = sanitizeMessageToolText(presentation.title);
  }
  if (Array.isArray(presentation.blocks)) {
    presentation.blocks = presentation.blocks.map((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return block;
      }
      const sanitizedBlock = { ...(block as Record<string, unknown>) };
      for (const field of ["text", "placeholder"]) {
        if (typeof sanitizedBlock[field] === "string") {
          sanitizedBlock[field] = sanitizeMessageToolText(sanitizedBlock[field]);
        }
      }
      if (Array.isArray(sanitizedBlock.buttons)) {
        sanitizedBlock.buttons = sanitizedBlock.buttons.map((button) => {
          if (!button || typeof button !== "object" || Array.isArray(button)) {
            return button;
          }
          const sanitizedButton = { ...(button as Record<string, unknown>) };
          if (typeof sanitizedButton.label === "string") {
            sanitizedButton.label = sanitizeMessageToolText(sanitizedButton.label);
          }
          return sanitizedButton;
        });
      }
      if (Array.isArray(sanitizedBlock.options)) {
        sanitizedBlock.options = sanitizedBlock.options.map((option) => {
          if (!option || typeof option !== "object" || Array.isArray(option)) {
            return option;
          }
          const sanitizedOption = { ...(option as Record<string, unknown>) };
          if (typeof sanitizedOption.label === "string") {
            sanitizedOption.label = sanitizeMessageToolText(sanitizedOption.label);
          }
          return sanitizedOption;
        });
      }
      return sanitizedBlock;
    });
  }
  return presentation;
}

export function sanitizeMessageToolSendArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const params = { ...args };
  for (const field of ["text", "content", "message", "caption"]) {
    if (typeof params[field] === "string") {
      params[field] = sanitizeMessageToolText(params[field]);
    }
  }
  params.presentation = sanitizeMessageToolPresentationTextFields(params.presentation);
  return params;
}
