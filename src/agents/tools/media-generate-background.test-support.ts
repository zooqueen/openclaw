import { expect, vi } from "vitest";

type MockWithReset = {
  mockReset(): void;
};

export const taskExecutorMocks = {
  createRunningTaskRun: vi.fn(),
  recordTaskRunProgressByRunId: vi.fn(),
  completeTaskRunByRunId: vi.fn(),
  failTaskRunByRunId: vi.fn(),
};

export const announceDeliveryMocks = {
  deliverSubagentAnnouncement: vi.fn(),
};

type TaskExecutorBackgroundMocks = {
  createRunningTaskRun: MockWithReset;
  recordTaskRunProgressByRunId: MockWithReset;
};

type AnnouncementBackgroundMocks = {
  deliverSubagentAnnouncement: MockWithReset;
};

type MediaBackgroundResetMocks = {
  taskExecutorMocks: TaskExecutorBackgroundMocks;
  announceDeliveryMocks: AnnouncementBackgroundMocks;
};

type QueuedTaskExpectation = {
  taskExecutorMocks: TaskExecutorBackgroundMocks;
  taskKind: string;
  sourceId: string;
  progressSummary: string;
};

type ProgressExpectation = {
  taskExecutorMocks: TaskExecutorBackgroundMocks;
  runId: string;
  progressSummary: string;
};

type FallbackAnnouncementExpectation = {
  deliverAnnouncementMock: unknown;
  requesterSessionKey: string;
  channel: string;
  to: string;
  source: string;
  announceType: string;
  resultMediaPath: string;
  mediaUrls: string[];
};

type CompletionFixtureParams = {
  mediaUrls?: string[];
  result: string;
  runId: string;
  taskLabel: string;
};

export function createMediaCompletionFixture({
  mediaUrls,
  result,
  runId,
  taskLabel,
}: CompletionFixtureParams) {
  return {
    handle: {
      taskId: "task-123",
      runId,
      requesterSessionKey: "agent:main:discord:direct:123",
      requesterOrigin: {
        channel: "discord",
        to: "channel:1",
        threadId: "thread-1",
      },
      taskLabel,
    },
    status: "ok" as const,
    statusLabel: "completed successfully",
    result,
    ...(mediaUrls ? { mediaUrls } : {}),
  };
}

export function resetMediaBackgroundMocks({
  taskExecutorMocks,
  announceDeliveryMocks,
}: MediaBackgroundResetMocks): void {
  taskExecutorMocks.createRunningTaskRun.mockReset();
  taskExecutorMocks.recordTaskRunProgressByRunId.mockReset();
  announceDeliveryMocks.deliverSubagentAnnouncement.mockReset();
}

export function expectQueuedTaskRun({
  taskExecutorMocks,
  taskKind,
  sourceId,
  progressSummary,
}: QueuedTaskExpectation): void {
  expect(taskExecutorMocks.createRunningTaskRun).toHaveBeenCalledWith(
    expect.objectContaining({
      taskKind,
      sourceId,
      progressSummary,
    }),
  );
}

export function expectRecordedTaskProgress({
  taskExecutorMocks,
  runId,
  progressSummary,
}: ProgressExpectation): void {
  expect(taskExecutorMocks.recordTaskRunProgressByRunId).toHaveBeenCalledWith(
    expect.objectContaining({
      runId,
      progressSummary,
    }),
  );
}

export function expectFallbackMediaAnnouncement({
  deliverAnnouncementMock,
  requesterSessionKey,
  channel,
  to,
  source,
  announceType,
  resultMediaPath,
  mediaUrls,
}: FallbackAnnouncementExpectation): void {
  expect(deliverAnnouncementMock).toHaveBeenCalledWith(
    expect.objectContaining({
      requesterSessionKey,
      requesterOrigin: expect.objectContaining({
        channel,
        to,
      }),
      expectsCompletionMessage: true,
      internalEvents: expect.arrayContaining([
        expect.objectContaining({
          source,
          announceType,
          status: "ok",
          result: expect.stringContaining(resultMediaPath),
          mediaUrls,
          replyInstruction: expect.stringContaining("Prefer the message tool for delivery"),
        }),
      ]),
    }),
  );
}
