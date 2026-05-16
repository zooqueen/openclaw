import { Effect } from "effect";

import { promiseEffect, runOpenClawEffect, type OpenClawEffect } from "./index.js";

export type RetryingPromiseParams<T> = {
  operation: () => Promise<T>;
  maxAttempts: number;
  shouldRetry: (error: unknown, attemptNumber: number) => boolean;
  resolveDelayMs: (attemptNumber: number) => number;
  sleep: (delayMs: number) => Promise<void>;
};

function runAttempt<T>(
  params: RetryingPromiseParams<T>,
  attemptNumber: number,
): OpenClawEffect<T, unknown> {
  return Effect.suspend(() =>
    promiseEffect({
      try: () => params.operation(),
    }).pipe(
      Effect.catchAll((error) => {
        if (attemptNumber >= params.maxAttempts || !params.shouldRetry(error, attemptNumber)) {
          return Effect.fail(error);
        }
        return promiseEffect({
          try: () => params.sleep(params.resolveDelayMs(attemptNumber)),
        }).pipe(Effect.flatMap(() => runAttempt(params, attemptNumber + 1)));
      }),
    ),
  );
}

export async function runRetryingPromise<T>(params: RetryingPromiseParams<T>): Promise<T> {
  return await runOpenClawEffect(runAttempt(params, 1));
}
