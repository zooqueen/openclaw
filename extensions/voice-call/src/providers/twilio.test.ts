import { describe, expect, it } from "vitest";

import { TwilioProvider } from "./twilio.js";

const mockTwilioConfig = {
  accountSid: "AC00000000000000000000000000000000",
  authToken: "test-token",
};

const callId = "internal-call-id";
const twimlPayload =
  "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>Hi</Say></Response>";

describe("TwilioProvider", () => {
  it("serves stored TwiML on twiml requests without emitting events", async () => {
    const provider = new TwilioProvider(mockTwilioConfig);
    (provider as unknown as { apiRequest: (endpoint: string, params: Record<string, string>) => Promise<unknown> }).apiRequest =
      async () => ({
        sid: "CA00000000000000000000000000000000",
        status: "queued",
        direction: "outbound-api",
        from: "+15550000000",
        to: "+15550000001",
        uri: "/Calls/CA00000000000000000000000000000000.json",
      });

    await provider.initiateCall({
      callId,
      to: "+15550000000",
      from: "+15550000001",
      webhookUrl: "https://example.com/voice/webhook?provider=twilio",
      inlineTwiml: twimlPayload,
    });

    const result = provider.parseWebhookEvent({
      headers: { host: "example.com" },
      rawBody:
        "CallSid=CA00000000000000000000000000000000&CallStatus=initiated&Direction=outbound-api",
      url: `https://example.com/voice/webhook?provider=twilio&callId=${callId}&type=twiml`,
      method: "POST",
      query: { provider: "twilio", callId, type: "twiml" },
    });

    expect(result.events).toHaveLength(0);
    expect(result.providerResponseBody).toBe(twimlPayload);
  });

  it("does not consume stored TwiML on status callbacks", async () => {
    const provider = new TwilioProvider(mockTwilioConfig);
    (provider as unknown as { apiRequest: (endpoint: string, params: Record<string, string>) => Promise<unknown> }).apiRequest =
      async () => ({
        sid: "CA00000000000000000000000000000000",
        status: "queued",
        direction: "outbound-api",
        from: "+15550000000",
        to: "+15550000001",
        uri: "/Calls/CA00000000000000000000000000000000.json",
      });

    await provider.initiateCall({
      callId,
      to: "+15550000000",
      from: "+15550000001",
      webhookUrl: "https://example.com/voice/webhook?provider=twilio",
      inlineTwiml: twimlPayload,
    });

    const statusResult = provider.parseWebhookEvent({
      headers: { host: "example.com" },
      rawBody:
        "CallSid=CA00000000000000000000000000000000&CallStatus=initiated&Direction=outbound-api&From=%2B15550000000&To=%2B15550000001",
      url: `https://example.com/voice/webhook?provider=twilio&callId=${callId}&type=status`,
      method: "POST",
      query: { provider: "twilio", callId, type: "status" },
    });

    expect(statusResult.events).toHaveLength(1);
    expect(statusResult.events[0]?.type).toBe("call.initiated");
    expect(statusResult.providerResponseBody).not.toBe(twimlPayload);

    const twimlResult = provider.parseWebhookEvent({
      headers: { host: "example.com" },
      rawBody:
        "CallSid=CA00000000000000000000000000000000&CallStatus=initiated&Direction=outbound-api",
      url: `https://example.com/voice/webhook?provider=twilio&callId=${callId}&type=twiml`,
      method: "POST",
      query: { provider: "twilio", callId, type: "twiml" },
    });

    expect(twimlResult.providerResponseBody).toBe(twimlPayload);
  });
});
