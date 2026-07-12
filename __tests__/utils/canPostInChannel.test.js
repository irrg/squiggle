import { describe, it, expect, vi, beforeEach } from "vitest";

const mockBotConfig = {};
vi.mock("../../config/config.json", () => ({
  default: { bot: mockBotConfig },
}));

const { default: canPostInChannel } =
  await import("../../src/utils/canPostInChannel.js");

describe("canPostInChannel", () => {
  beforeEach(() => {
    delete mockBotConfig.whitelist;
    delete mockBotConfig.blacklist;
  });

  it("allows any channel when neither list is configured", () => {
    expect(canPostInChannel("anything")).toBe(true);
  });

  it("allows whitelisted channel", () => {
    mockBotConfig.whitelist = ["general", "bot-spam"];
    expect(canPostInChannel("general")).toBe(true);
  });

  it("blocks non-whitelisted channel when whitelist is set", () => {
    mockBotConfig.whitelist = ["general"];
    expect(canPostInChannel("off-topic")).toBe(false);
  });

  it("blocks blacklisted channel", () => {
    mockBotConfig.blacklist = ["admin", "mod-only"];
    expect(canPostInChannel("admin")).toBe(false);
  });

  it("allows non-blacklisted channel when blacklist is set", () => {
    mockBotConfig.blacklist = ["admin"];
    expect(canPostInChannel("general")).toBe(true);
  });

  it("whitelist takes precedence when both are set", () => {
    mockBotConfig.whitelist = ["general"];
    mockBotConfig.blacklist = ["general"];
    expect(canPostInChannel("general")).toBe(true);
    expect(canPostInChannel("other")).toBe(false);
  });
});
