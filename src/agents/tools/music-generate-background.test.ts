import { beforeEach, describe, expect, it, vi } from "vitest";
import { MUSIC_GENERATION_TASK_KIND } from "../music-generation-task-status.js";
import {
  announceDeliveryMocks,
  createMediaCompletionFixture,
  expectFallbackMediaAnnouncement,
  expectQueuedTaskRun,
  expectRecordedTaskProgress,
  resetMediaBackgroundMocks,
  taskExecutorMocks,
} from "./media-generate-background.test-support.js";

vi.mock("../../tasks/detached-task-runtime.js", () => taskExecutorMocks);
vi.mock("../subagent-announce-delivery.js", () => announceDeliveryMocks);

const {
  createMusicGenerationTaskRun,
  recordMusicGenerationTaskProgress,
  wakeMusicGenerationTaskCompletion,
} = await import("./music-generate-background.js");

describe("music generate background helpers", () => {
  beforeEach(() => {
    resetMediaBackgroundMocks({
      taskExecutorMocks,
      announceDeliveryMocks,
    });
  });

  it("creates a running task with queued progress text", () => {
    taskExecutorMocks.createRunningTaskRun.mockReturnValue({
      taskId: "task-123",
    });

    const handle = createMusicGenerationTaskRun({
      sessionKey: "agent:main:discord:direct:123",
      requesterOrigin: {
        channel: "discord",
        to: "channel:1",
      },
      prompt: "night-drive synthwave",
      providerId: "google",
    });

    expect(handle).toMatchObject({
      taskId: "task-123",
      requesterSessionKey: "agent:main:discord:direct:123",
      taskLabel: "night-drive synthwave",
    });
    expectQueuedTaskRun({
      taskExecutorMocks,
      taskKind: MUSIC_GENERATION_TASK_KIND,
      sourceId: "music_generate:google",
      progressSummary: "Queued music generation",
    });
  });

  it("records task progress updates", () => {
    recordMusicGenerationTaskProgress({
      handle: {
        taskId: "task-123",
        runId: "tool:music_generate:abc",
        requesterSessionKey: "agent:main:discord:direct:123",
        taskLabel: "night-drive synthwave",
      },
      progressSummary: "Saving generated music",
    });

    expectRecordedTaskProgress({
      taskExecutorMocks,
      runId: "tool:music_generate:abc",
      progressSummary: "Saving generated music",
    });
  });

  it("queues a completion event by default when direct send is disabled", async () => {
    announceDeliveryMocks.deliverSubagentAnnouncement.mockResolvedValue({
      delivered: true,
      path: "direct",
    });

    await wakeMusicGenerationTaskCompletion({
      ...createMediaCompletionFixture({
        runId: "tool:music_generate:abc",
        taskLabel: "night-drive synthwave",
        result: "Generated 1 track.\nMEDIA:/tmp/generated-night-drive.mp3",
        mediaUrls: ["/tmp/generated-night-drive.mp3"],
      }),
    });

    expect(announceDeliveryMocks.deliverSubagentAnnouncement).toHaveBeenCalled();
  });

  it("queues the music-generation completion event for assistant delivery", async () => {
    announceDeliveryMocks.deliverSubagentAnnouncement.mockResolvedValue({
      delivered: true,
      path: "direct",
    });

    await wakeMusicGenerationTaskCompletion({
      ...createMediaCompletionFixture({
        runId: "tool:music_generate:abc",
        taskLabel: "night-drive synthwave",
        result: "Generated 1 track.\nMEDIA:/tmp/generated-night-drive.mp3",
        mediaUrls: ["/tmp/generated-night-drive.mp3"],
      }),
    });

    expectFallbackMediaAnnouncement({
      deliverAnnouncementMock: announceDeliveryMocks.deliverSubagentAnnouncement,
      requesterSessionKey: "agent:main:discord:direct:123",
      channel: "discord",
      to: "channel:1",
      source: "music_generation",
      announceType: "music generation task",
      resultMediaPath: "MEDIA:/tmp/generated-night-drive.mp3",
      mediaUrls: ["/tmp/generated-night-drive.mp3"],
    });
  });
});
