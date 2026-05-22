import { describe, it, expect } from "vitest";
import SEARCH_INDEX from "../res/context.json";
import {
  retrieveRelevantChunks,
  inferStage,
  buildDynamicContext,
} from "../src/context";

type Index = { chunks: Array<{ id: string; text: string; tags?: string[] }> };

describe("real context.json sanity", () => {
  it("has chunks and basic fields", () => {
    const idx = SEARCH_INDEX as unknown as Index;
    expect(Array.isArray(idx.chunks)).toBe(true);
    expect(idx.chunks.length).toBeGreaterThan(50); // adjust threshold to your real size
    expect(idx.chunks[0]).toHaveProperty("id");
    expect(idx.chunks[0]).toHaveProperty("text");
  });

  it("retrieval returns <= max and does not throw", () => {
    const res = retrieveRelevantChunks("security audit", { max: 6 });
    expect(res.length).toBeLessThanOrEqual(6);
  });

  it("dynamic context is compact", () => {
    const res = retrieveRelevantChunks("observability monitoring latency", {
      max: 6,
    });
    const ctx = buildDynamicContext(res as any, "technical");
    // basic guard: don’t accidentally inject huge context
    expect(ctx.length).toBeLessThan(2000);
  });

  it("stage inference doesn't crash on real queries", () => {
    expect(
      inferStage("Need help before launch with monitoring and load testing"),
    ).toBeTruthy();
  });
});
