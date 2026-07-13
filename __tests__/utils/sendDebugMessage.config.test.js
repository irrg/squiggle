import { describe, it, expect, vi } from "vitest";

vi.mock("../../config/config.json", () => ({
  default: { bot: { debugChannel: "custom-debug" } },
}));

const { default: sendDebugMessage } =
  await import("../../src/utils/sendDebugMessage.js");

describe("sendDebugMessage with configured debug channel", () => {
  it("sends to the channel named in config.bot.debugChannel", async () => {
    const mockChannel = {
      name: "custom-debug",
      send: vi.fn().mockResolvedValue(undefined),
    };
    const client = {
      channels: {
        cache: {
          find: vi.fn((predicate) =>
            predicate(mockChannel) ? mockChannel : undefined,
          ),
        },
      },
    };

    await sendDebugMessage(client, "hello");

    expect(mockChannel.send).toHaveBeenCalledWith("⚠️ hello");
  });
});
