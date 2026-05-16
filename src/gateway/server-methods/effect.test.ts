import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { invalidGatewayMethodRequest, respondWithGatewayEffect } from "./effect.js";

describe("gateway method Effect adapter", () => {
  it("responds with the successful Effect payload", async () => {
    const respond = vi.fn();

    await respondWithGatewayEffect({
      respond,
      effect: Effect.succeed({ ok: true }),
      meta: { cached: true },
    });

    expect(respond).toHaveBeenCalledWith(true, { ok: true }, undefined, { cached: true });
  });

  it("maps expected gateway failures to protocol errors", async () => {
    const respond = vi.fn();

    await respondWithGatewayEffect({
      respond,
      effect: Effect.fail(invalidGatewayMethodRequest("bad params")),
    });

    expect(respond).toHaveBeenCalledWith(false, undefined, {
      code: "INVALID_REQUEST",
      message: "bad params",
    });
  });
});
