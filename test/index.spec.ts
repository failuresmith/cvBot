import { describe, it, expect, vi } from "vitest";

// ---- Mock the search index JSON imported by src/context.ts ----
// Adjust the relative path if your context.ts imports from a different location.
vi.mock("../res/context.json", () => {
  return {
    default: {
      schema: "context_v1",
      chunks: [
        {
          id: "c_audit_1",
          text: "Performed security audit and threat modeling; identified authorization failure modes and mitigations.",
          tags: ["security", "audit", "threat", "authz", "failure-modes"],
          stage_hints: ["architecture_review"],
          weight: 30,
        },
        {
          id: "c_launch_1",
          text: "Pre-launch hardening: added observability (logs/metrics/traces) and load testing to reduce launch risk.",
          tags: [
            "prelaunch",
            "observability",
            "monitoring",
            "latency",
            "load",
            "perf",
          ],
          stage_hints: ["prelaunch_hardening"],
          weight: 25,
        },
        {
          id: "c_feature_1",
          text: "Owned feature end-to-end: implemented payments integration and shipped MVP improvements weekly.",
          tags: ["feature", "ownership", "mvp", "payments", "shipping"],
          stage_hints: ["feature_ownership", "idea_to_product"],
          weight: 15,
        },
        {
          id: "c_noise_1",
          text: "Enjoys collaboration and clear communication.",
          tags: ["soft-skills"],
          stage_hints: ["general"],
          weight: 1,
        },
      ],
    },
  };
});

// Import AFTER the mock so context.ts sees the mocked JSON
import {
  inferStage,
  retrieveRelevantChunks,
  buildDynamicContext,
} from "../src/context";
import { CONTACT_DETAILS } from "../src/contact";
import worker from "../src/index";
import { CORE_INSTRUCTION } from "../src/prompts";

function streamFrom(parts: string[]) {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(part));
      }
      controller.close();
    },
  });
}

describe("inferStage()", () => {
  it("detects architecture_review intent", () => {
    expect(
      inferStage("Can you do an architecture audit and threat model?"),
    ).toBe("architecture_review");
    expect(inferStage("security review for authz vulnerabilities")).toBe(
      "architecture_review",
    );
  });

  it("detects prelaunch_hardening intent", () => {
    expect(
      inferStage(
        "We are launching next week. Need observability and load testing.",
      ),
    ).toBe("prelaunch_hardening");
    expect(
      inferStage("reduce latency, add monitoring, prep for beta launch"),
    ).toBe("prelaunch_hardening");
  });

  it("detects feature_ownership intent", () => {
    expect(
      inferStage("We need someone to own a feature end-to-end and ship fast."),
    ).toBe("feature_ownership");
  });

  it("detects idea_to_product intent", () => {
    expect(
      inferStage("Need a lead engineer for prototype / MVP, 0 to 1."),
    ).toBe("idea_to_product");
  });

  it("returns undefined when no strong signals", () => {
    expect(inferStage("Hello there")).toBe(undefined);
    expect(inferStage("Tell me about Milad")).toBe(undefined);
  });
});

describe("retrieveRelevantChunks()", () => {
  it("returns the most relevant chunks for a query", () => {
    const res = retrieveRelevantChunks(
      "security audit authorization failure modes",
      { max: 2 },
    );
    expect(res.length).toBeGreaterThan(0);
    expect(res.length).toBeLessThanOrEqual(2);
    expect(res[0].id).toBe("c_audit_1");
  });

  it("respects max parameter", () => {
    const res = retrieveRelevantChunks("mvp ship payments", { max: 1 });
    expect(res.length).toBe(1);
  });

  it("stage reranking boosts matching stage_hints", () => {
    const res = retrieveRelevantChunks("monitoring and risk before launch", {
      max: 2,
      stage: "prelaunch_hardening",
    });
    expect(res[0].id).toBe("c_launch_1");
  });

  it("returns empty array when nothing matches", () => {
    const res = retrieveRelevantChunks("quantum entanglement astrophysics", {
      max: 3,
    });
    expect(res).toEqual([]);
  });
});

describe("buildDynamicContext()", () => {
  it("formats a compact context block with bullets", () => {
    const chunks = retrieveRelevantChunks("audit security authz", { max: 2 });
    const ctx = buildDynamicContext(chunks as any, "technical");
    expect(ctx).toContain("RELEVANT_MILAD_CONTEXT");
    expect(ctx).toContain("Performed security audit");
    expect(
      ctx.split("\n").filter((l) => l.startsWith("- ")).length,
    ).toBeGreaterThan(0);
  });

  it("returns empty string if no chunks", () => {
    const ctx = buildDynamicContext([], "non-technical");
    expect(ctx).toBe("");
  });

  it("includes tone-specific guidance line", () => {
    const chunks = retrieveRelevantChunks("launch observability", { max: 1 });
    const techCtx = buildDynamicContext(chunks as any, "technical");
    const bizCtx = buildDynamicContext(chunks as any, "non-technical");
    expect(techCtx).toMatch(/architecture tradeoffs/i);
    expect(bizCtx).toMatch(/outcomes\/risks\/timelines/i);
  });
});

describe("prompts", () => {
  it("uses canonical contact details for model fallback contact handling", () => {
    for (const detail of Object.values(CONTACT_DETAILS)) {
      expect(CORE_INSTRUCTION).toContain(detail);
    }

    expect(CORE_INSTRUCTION).toMatch(/direct or indirect requests/i);
    expect(CORE_INSTRUCTION).not.toContain("failuresmith");
  });
});

describe("fetch()", () => {
  it("returns contact details directly without calling AI", async () => {
    const env = {
      AI: {
        run: vi.fn(),
      },
    } as any;

    const response = await worker.fetch(
      new Request("https://example.test/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tone: "non-technical",
          history: [],
          message: "How should I contact you?",
        }),
      }),
      env,
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(text).toContain("Email: miladtsx@gmail.com");
    expect(text).toContain("Telegram: https://t.me/miladtsx");
    expect(text).toContain("Booking: https://cal.com/miladtsx/intro");
    expect(text).not.toMatch(/\?/);
    expect(text).toContain("data: [DONE]");
  });

  it("filters provider-only fields from streamed AI responses", async () => {
    const rawStream = streamFrom([
      'data: {"response":"What","p":"abc"}\n\n',
      'data: {"response":"","p":"heartbeat"}\n',
      "\n",
      'data: {"response":" next","p":"def"}\n\n',
      'data: {"response":"","usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
      "data: [DONE]\n\n",
    ]);
    const env = {
      AI: {
        run: vi.fn(async () => rawStream),
      },
    } as any;

    const response = await worker.fetch(
      new Request("https://example.test/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tone: "non-technical",
          history: [
            { role: "user", content: "Can you help with my software idea?" },
          ],
          message: "Can you help with my software idea?",
        }),
      }),
      env,
    );

    const text = await response.text();

    expect(response.status).toBe(200);
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-120b",
      expect.objectContaining({ stream: true, temperature: 0 }),
    );
    expect(text).toContain('data: {"response":"What"}');
    expect(text).toContain('data: {"response":" next"}');
    expect(text).toContain(
      'data: {"response":"","usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
    );
    expect(text).toContain("data: [DONE]");
    expect(text).not.toContain('"p"');
    expect(text).not.toContain("heartbeat");
  });
});
