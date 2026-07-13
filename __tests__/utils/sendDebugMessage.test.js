import { describe, it, expect, vi } from "vitest";

// No debugChannel configured — util must fall back to the default name
vi.mock("../../config/config.json", () => ({ default: { bot: {} } }));

const { default: sendDebugMessage } =
  await import("../../src/utils/sendDebugMessage.js");

const makeClient = (channelFound = true) => {
  const mockChannel = { send: vi.fn().mockResolvedValue(undefined) };
  return {
    channel: channelFound ? mockChannel : null,
    client: {
      channels: {
        cache: {
          find: vi.fn((predicate) =>
            predicate({ name: "🤖bot-messages" })
              ? channelFound
                ? mockChannel
                : undefined
              : undefined,
          ),
        },
      },
    },
    mockChannel,
  };
};

describe("sendDebugMessage", () => {
  it("sends message to debug channel", async () => {
    const { client, mockChannel } = makeClient();
    await sendDebugMessage(client, "hello");
    expect(mockChannel.send).toHaveBeenCalledWith("⚠️ hello");
  });

  it("does not throw when debug channel not in cache", async () => {
    const { client } = makeClient(false);
    await expect(sendDebugMessage(client, "hello")).resolves.toBeUndefined();
  });

  it("joins array of messages with newlines", async () => {
    const { client, mockChannel } = makeClient();
    await sendDebugMessage(client, ["one", "two"]);
    expect(mockChannel.send).toHaveBeenCalledWith("⚠️ one\n⚠️ two");
  });

  it("prefixes suboption messages with dashes", async () => {
    const { client, mockChannel } = makeClient();
    await sendDebugMessage(client, ["a", "b"], { suboption: true });
    expect(mockChannel.send).toHaveBeenCalledWith("- a\n- b");
  });

  it("wraps message in bold markdown when bold option set", async () => {
    const { client, mockChannel } = makeClient();
    await sendDebugMessage(client, "important", { bold: true });
    expect(mockChannel.send).toHaveBeenCalledWith("**⚠️ important**");
  });

  it("uses custom emoji when provided", async () => {
    const { client, mockChannel } = makeClient();
    await sendDebugMessage(client, "hi", { emoji: "🎉" });
    expect(mockChannel.send).toHaveBeenCalledWith("🎉 hi");
  });
});
