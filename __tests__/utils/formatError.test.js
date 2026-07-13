import { describe, it, expect } from "vitest";
import formatError from "../../src/utils/formatError.js";

describe("formatError", () => {
  it("includes message and stack for Error instances", () => {
    const error = new Error("something broke");
    const result = formatError(error);

    expect(result).toContain("something broke");
    expect(result).toContain("formatError.test.js");
  });

  it("falls back to message when stack is missing", () => {
    const error = new Error("no stack here");
    error.stack = undefined;

    expect(formatError(error)).toBe("no stack here");
  });

  it("serializes non-Error values as JSON", () => {
    expect(formatError({ code: 50013 })).toContain("50013");
  });
});
