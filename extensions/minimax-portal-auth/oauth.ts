import { createHash, randomBytes, randomUUID } from "node:crypto";

const MINIMAX_OAUTH_BASE_URL = "https://api.minimax.io";
const MINIMAX_OAUTH_CODE_ENDPOINT = `${MINIMAX_OAUTH_BASE_URL}/oauth/code`;
const MINIMAX_OAUTH_TOKEN_ENDPOINT = `${MINIMAX_OAUTH_BASE_URL}/oauth/token`;
const MINIMAX_OAUTH_CLIENT_ID = "78257093-7e40-4613-99e0-527b14b39113";
const MINIMAX_OAUTH_SCOPE = "group_id profile model.completion";
const MINIMAX_OAUTH_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:user_code";

export type MiniMaxOAuthAuthorization = {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
  has_benefit: boolean;
  benefit_message: string;
  state: string;
};

export type MiniMaxOAuthToken = {
  access: string;
  refresh: string;
  expires: number;
  resourceUrl?: string;
};

type TokenPending = { status: "pending"; message?: string };

type TokenResult =
  | { status: "success"; token: MiniMaxOAuthToken }
  | TokenPending
  | { status: "error"; message: string };

function toFormUrlEncoded(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function generatePkce(): { verifier: string; challenge: string; state: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

async function requestOAuthCode(params: {
  challenge: string;
  state: string;
}): Promise<MiniMaxOAuthAuthorization> {
  const response = await fetch(MINIMAX_OAUTH_CODE_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "x-request-id": randomUUID(),
    },
    body: toFormUrlEncoded({
      response_type:"code",
      client_id: MINIMAX_OAUTH_CLIENT_ID,
      scope: MINIMAX_OAUTH_SCOPE,
      code_challenge: params.challenge,
      code_challenge_method: "S256",
      state: params.state,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`MiniMax OAuth authorization failed: ${text || response.statusText}`);
  }

  const payload = (await response.json()) as MiniMaxOAuthAuthorization & { error?: string };
  if (!payload.user_code || !payload.verification_uri) {
    throw new Error(
      payload.error ??
        "MiniMax OAuth authorization returned an incomplete payload (missing user_code or verification_uri).",
    );
  }
  if (payload.state !== params.state) {
    throw new Error(
      "MiniMax OAuth state mismatch: possible CSRF attack or session corruption.",
    );
  }
  return payload;
}

async function pollOAuthToken(params: {
  userCode: string;
  verifier: string;
}): Promise<TokenResult> {
  const response = await fetch(MINIMAX_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: toFormUrlEncoded({
      grant_type: MINIMAX_OAUTH_GRANT_TYPE,
      client_id: MINIMAX_OAUTH_CLIENT_ID,
      user_code: params.userCode,
      code_verifier: params.verifier,
    }),
  });

  if (!response.ok) {
    let payload: {
      status?: string;
      base_resp?: { status_code?: number; status_msg?: string };
    } | undefined;
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      return { status: "error", message: response.statusText };
    }
    return {
      status: "error",
      message: payload?.base_resp?.status_msg ?? response.statusText,
    };
  }

  const tokenPayload = (await response.json()) as {
    status: string;
    access_token?: string | null;
    refresh_token?: string | null;
    expired_in?: number | null;
    token_type?: string;
    resource_url?: string;
  };
  if (tokenPayload.status != "success") {
    return { status: "pending", message: "current user code is not authorized" };
  }

  if (!tokenPayload.access_token || !tokenPayload.refresh_token || !tokenPayload.expired_in) {
    return { status: "error", message: "MiniMax OAuth returned incomplete token payload." };
  }

  return {
    status: "success",
    token: {
      access: tokenPayload.access_token,
      refresh: tokenPayload.refresh_token,
      expires: Date.now() + tokenPayload.expired_in * 1000,
      resourceUrl: tokenPayload.resource_url,
    },
  };
}

export async function loginMiniMaxPortalOAuth(params: {
  openUrl: (url: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (message: string) => void; stop: (message?: string) => void };
}): Promise<MiniMaxOAuthToken> {
  const { verifier, challenge, state } = generatePkce();
  const oauth = await requestOAuthCode({ challenge, state });
  const verificationUrl = oauth.verification_uri;

  const noteLines = [
    `Open ${verificationUrl} to approve access.`,
    `If prompted, enter the code ${oauth.user_code}.`,
  ];
  if (oauth.has_benefit && oauth.benefit_message) {
    noteLines.push("", oauth.benefit_message);
  }
  await params.note(noteLines.join("\n"), "MiniMax OAuth");

  try {
    await params.openUrl(verificationUrl);
  } catch {
    // Fall back to manual copy/paste if browser open fails.
  }

  const start = Date.now();
  let pollIntervalMs = oauth.interval ? oauth.interval * 1000 : 2000;
  const timeoutMs = oauth.expires_in * 1000;

  while (Date.now() - start < timeoutMs) {
    params.progress.update("Waiting for MiniMax OAuth approval…");
    const result = await pollOAuthToken({
      userCode: oauth.user_code,
      verifier,
    });

    if (result.status === "success") {
      return result.token;
    }

    if (result.status === "error") {
      throw new Error(`MiniMax OAuth failed: ${result.message}`);
    }

    if (result.status === "pending") {
      pollIntervalMs = Math.min(pollIntervalMs * 1.5, 10000);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error("MiniMax OAuth timed out waiting for authorization.");
}
