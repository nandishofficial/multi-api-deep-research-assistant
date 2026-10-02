import { describe, expect, it } from "vitest";
import { backoffMs, classifyError, withRetry } from "@/server/util/errors";

describe("classifyError", () => {
  it("classifies rate limits, server errors and network failures as transient", () => {
    expect(classifyError(Object.assign(new Error("Rate limit reached"), { status: 429 })).kind).toBe("transient");
    expect(classifyError(Object.assign(new Error("bad gateway"), { status: 502 })).kind).toBe("transient");
    expect(classifyError(Object.assign(new Error("socket"), { code: "ECONNRESET" })).kind).toBe("transient");
  });

  it("detects unavailable models", () => {
    expect(classifyError(Object.assign(new Error("The model `o3-deep-research` does not exist or you do not have access to it."), { status: 404 })).kind).toBe(
      "model_unavailable",
    );
    expect(classifyError(Object.assign(new Error("Agent deep-research-x not found"), { status: 404 })).kind).toBe("model_unavailable");
  });

  it("treats auth / validation errors as permanent", () => {
    expect(classifyError(Object.assign(new Error("Incorrect API key provided"), { status: 401 })).kind).toBe("permanent");
    expect(classifyError(Object.assign(new Error("Invalid value for 'input'"), { status: 400 })).kind).toBe("permanent");
  });
});

describe("backoff", () => {
  it("grows exponentially within bounds", () => {
    expect(backoffMs(1, 1000, 60_000, () => 1)).toBe(1000);
    expect(backoffMs(3, 1000, 60_000, () => 1)).toBe(4000);
    expect(backoffMs(20, 1000, 60_000, () => 1)).toBe(60_000);
    expect(backoffMs(3, 1000, 60_000, () => 0)).toBe(2000);
  });

  it("withRetry retries transient errors only", async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n++;
        if (n < 2) throw Object.assign(new Error("overloaded"), { status: 503 });
        return "ok";
      },
      { baseMs: 1, maxMs: 2 },
    );
    expect(out).toBe("ok");
    let m = 0;
    await expect(
      withRetry(async () => {
        m++;
        throw Object.assign(new Error("bad request"), { status: 400 });
      }),
    ).rejects.toThrow("bad request");
    expect(m).toBe(1);
  });
});
