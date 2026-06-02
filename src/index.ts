import {
  buildDynamicContext,
  inferStage,
  retrieveRelevantChunks,
} from "./context";
import { createPublicAiStream } from "./aiStream";
import { ChatRequest, ClientMessage, Tone } from "./types";
import { CORE_INSTRUCTION } from "./prompts";
import {
  CONTACT_DETAILS_RESPONSE,
  createStaticAiStream,
  isContactDetailsRequest,
} from "./contact";

const AI_MODEL = "@cf/google/gemma-4-26b-a4b-it";

type AiMessage = {
  role: "system" | ClientMessage["role"];
  content: string;
};

type CurrentAiModels = {
  [AI_MODEL]: {
    inputs: {
      messages: AiMessage[];
      stream: true;
      reasoning: false;
      temperature: number;
    };
    postProcessedOutputs: ReadableStream<Uint8Array>;
  };
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function toneSystem(tone: Tone) {
  if (tone === "technical") {
    return "TONE=technical. Be concise. Assume engineering audience. Prefer architecture + implementation details.";
  }
  return "TONE=non-technical. Use plain English. Focus on business outcomes, risks, timelines, and tradeoffs. Avoid technical jargon.";
}

function clamp(str: string, max: number) {
  return str.length > max ? str.slice(0, max) : str;
}

function sanitizeHistory(history: unknown): ClientMessage[] {
  if (!Array.isArray(history)) return [];
  const out: ClientMessage[] = [];
  for (const m of history) {
    const role = (m as any)?.role === "assistant" ? "assistant" : "user";
    const content = String((m as any)?.content ?? "").trim();
    if (!content) continue;
    out.push({ role, content: clamp(content, 4000) }); // clamp per message
    if (out.length >= 12) break; // keep last 12 messages max
  }
  return out;
}

async function parseJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response("OK", { status: 200, headers: corsHeaders });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: corsHeaders,
      });
    }

    const body = await parseJson<ChatRequest>(request);
    if (!body || typeof body.message !== "string") {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    const tone: Tone =
      body.tone === "technical" ? "technical" : "non-technical";
    const history = sanitizeHistory(body.history);
    const userMessage = clamp(body.message.trim(), 4000);
    if (!userMessage) {
      return new Response(JSON.stringify({ error: "Empty message" }), {
        status: 400,
        headers: { "content-type": "application/json", ...corsHeaders },
      });
    }

    if (isContactDetailsRequest(userMessage)) {
      return new Response(createStaticAiStream(CONTACT_DETAILS_RESPONSE), {
        status: 200,
        headers: { "content-type": "text/event-stream", ...corsHeaders },
      });
    }

    // ------ PROVIDE CONTEXT TO THE MODEL ------
    // infer stage from user message (optional but useful)
    const stage = inferStage(userMessage);

    // retrieve top 6 relevant chunks
    const relevant = retrieveRelevantChunks(userMessage, { max: 6, stage });

    // build a short dynamic context block
    const dynamicContext = buildDynamicContext(relevant, tone);

    // Build final messages (no template tokens; Workers AI handles formatting)
    const messages: AiMessage[] = [
      { role: "system", content: CORE_INSTRUCTION },
      { role: "system", content: toneSystem(tone) },
    ];
    if (dynamicContext) {
      messages.push({ role: "system", content: dynamicContext });
    }
    messages.push(...history, { role: "user", content: userMessage });

    const stream = await (env.AI as unknown as Ai<CurrentAiModels>).run(
      AI_MODEL,
      {
        messages,
        stream: true,
        reasoning: false,
        // Optional knobs if you want:
        // max_tokens: 500,
        temperature: 0,
      },
    );

    return new Response(
      createPublicAiStream(stream as ReadableStream<Uint8Array>),
      {
        status: 200,
        headers: { "content-type": "text/event-stream", ...corsHeaders },
      },
    );
  },
} satisfies ExportedHandler<Env>;
