import { Chunk, Meta, Tone } from "./types";
import SEARCH_INDEX from "../res/context.json";

export function inferStage(query: string): string | undefined {
  const q = query.toLowerCase();

  // architecture review first
  if (
    /(audit|review|security|threat|vuln|exploit|risk|failure mode|invariant)/.test(
      q,
    )
  )
    return "architecture_review";

  // prelaunch
  if (
    /(prelaunch|launch|beta|alpha|slo|sla|observability|monitoring|latency|load|perf|incident)/.test(
      q,
    )
  )
    return "prelaunch_hardening";

  // idea->product MUST be before feature ownership (because "MVP" overlaps)
  if (
    /(0\s*to\s*1|zero\s*to\s*one|prototype|cofounder|founding|ideation)/.test(q)
  )
    return "idea_to_product";

  // feature ownership last
  if (/(feature|ship|end-to-end|ownership|delivery|handoff|mvp)/.test(q))
    return "feature_ownership";

  return undefined;
}

export function retrieveRelevantChunks(
  query: string,
  opts?: { max?: number; stage?: string },
) {
  const max = opts?.max ?? 6;
  const stage = opts?.stage;

  const scored = SEARCH_INDEX.chunks
    .map((c) => ({ c, score: _scoreChunk(c, query, stage) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.c);

  return scored;
}

export function buildDynamicContext(chunks: Chunk[], tone: Tone) {
  if (!chunks.length) return "";

  // keep it short; bullets only
  const lines = chunks.map((c) => {
    const parts: string[] = [];

    // Required for citations
    parts.push(`[${c.id}]`);

    // Optional enrichments (so "project_name" is actually available)
    const meta: Meta | undefined = c.meta;
    if (meta?.name) parts.push(`Project: ${meta.name}`);
    if (meta?.role_title) parts.push(`Role: ${meta.role_title}`);
    if (meta?.dates?.start || meta?.dates?.end)
      parts.push(`Dates: ${meta.dates.start ?? "?"}–${meta.dates.end ?? "?"}`);

    // Keep text last
    parts.push(c.text);

    return `- ${parts.join(" | ")}`;
  });

  return [
    "RELEVANT_MILAD_CONTEXT (facts only):",
    "Rules:",
    "- You may ONLY state Milad facts supported by bullets below.",
    "- When stating a Milad fact, cite the supporting bullet id like [id].",
    "- Do NOT output placeholders like [chunk_id] or [project_name].",
    "",
    ...lines,
    "",
    tone === "technical"
      ? "If helpful, connect these facts to architecture tradeoffs."
      : "If helpful, connect these facts to outcomes/risks/timelines.",
  ].join("\n");
}

// -------------- Helpers

function _norm(s: string) {
  return s.toLowerCase();
}

function _tokenize(s: string) {
  return _norm(s)
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .slice(0, 40);
}

function _scoreChunk(chunk: Chunk, query: string, stage?: string) {
  const q = _norm(query);
  const text = _norm(chunk.text);
  const tags = (chunk.tags ?? []).map(_norm);
  const words = _tokenize(query);

  let base = 0;

  if (text.includes(q)) base += 8;

  for (const w of words) {
    if (text.includes(w)) base += 2;
    if (tags.includes(w)) base += 3;
  }

  // If nothing matches, score is 0 (do NOT add weight)
  if (base === 0) return 0;

  if (stage && chunk.stage_hints?.includes(stage)) base += 4;

  return base + (chunk.weight ?? 0);
}
