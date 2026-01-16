export function normalizeSlackToken(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveSlackBotToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}

export function resolveSlackAppToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}

export function resolveSlackUserToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}

export type SlackTokenOperation = "read" | "write";

export type SlackTokenSelection = {
  botToken?: string;
  userToken?: string;
  userTokenReadOnly?: boolean;
  operation: SlackTokenOperation;
};

function selectSlackTokenNormalized(params: SlackTokenSelection): string | undefined {
  const allowUserWrites = params.userTokenReadOnly === false;
  if (params.operation === "read") return params.userToken ?? params.botToken;
  if (!allowUserWrites) return params.botToken;
  return params.botToken ?? params.userToken;
}

export function selectSlackToken(params: SlackTokenSelection): string | undefined {
  const botToken = resolveSlackBotToken(params.botToken);
  const userToken = resolveSlackUserToken(params.userToken);
  return selectSlackTokenNormalized({
    ...params,
    botToken,
    userToken,
  });
}

export function resolveSlackTokenOverride(params: SlackTokenSelection): string | undefined {
  const botToken = resolveSlackBotToken(params.botToken);
  const userToken = resolveSlackUserToken(params.userToken);
  const token = selectSlackTokenNormalized({
    ...params,
    botToken,
    userToken,
  });
  return token && token !== botToken ? token : undefined;
}
