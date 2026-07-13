import { describe, it, expect, vi } from "vitest";
import path from "path";
import { loadCommands, loadWorkers, nonOverlapping } from "../src/loaders.js";

const fixturesDir = path.join(import.meta.dirname, "fixtures");

describe("loadCommands", () => {
  it("loads command modules with prefix applied", async () => {
    const commands = await loadCommands(
      path.join(fixturesDir, "commands"),
      "dev-",
    );

    const hello = commands.find((c) => c.name === "dev-hello");
    expect(hello).toBeDefined();
    expect(hello.description).toBe("Say hello");
    expect(hello.options).toHaveLength(1);
    expect(hello.init()).toBe("ran");
  });

  it("falls back to filename and default description", async () => {
    const commands = await loadCommands(path.join(fixturesDir, "commands"));

    const noName = commands.find((c) => c.name === "no-name");
    expect(noName).toBeDefined();
    expect(noName.description).toBe("No description provided");
    expect(noName.options).toEqual([]);
  });
});

describe("nonOverlapping", () => {
  it("skips invocations while a previous run is still in flight", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const wrapped = nonOverlapping(fn);

    await Promise.all([wrapped(), wrapped()]);
    expect(calls).toBe(1);

    await wrapped();
    expect(calls).toBe(2);
  });

  it("releases the lock even when the wrapped fn throws", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error("boom");
    };
    const wrapped = nonOverlapping(fn);

    await expect(wrapped()).rejects.toThrow("boom");
    await expect(wrapped()).rejects.toThrow("boom");
    expect(calls).toBe(2);
  });
});

describe("loadWorkers", () => {
  it("returns only workers with a valid positive interval", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const workers = await loadWorkers(path.join(fixturesDir, "workers"));

    expect(workers).toHaveLength(1);
    expect(workers[0].name).toBe("good.js");
    expect(workers[0].interval).toBe(5000);
    expect(typeof workers[0].run).toBe("function");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("bad-interval.js"),
    );

    errorSpy.mockRestore();
  });
});
