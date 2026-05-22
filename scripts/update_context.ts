#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

type Evidence = { ref?: string; note?: string };
type Bullet = {
  id?: string;
  text_short?: string;
  text_long?: string;
  text?: string;
  tags?: string[];
  claim_type?: string; // metric | fact | qualitative | ...
  confidence?: string; // high | medium | low
  evidence?: Evidence;
};

type Experience = {
  id?: string;
  org?: string;
  org_descriptor?: string;
  role?: { title?: string; level?: string };
  employment_type?: string;
  engagement?: string;
  phase?: string;
  dates?: any;
  tech_focus?: { tags?: string[] };
  bullets?: Bullet[];
};

type Project = {
  id?: string;
  name?: string;
  descriptor?: string;
  role?: { title?: string; employment_type?: string };
  dates?: any;
  bullets?: Bullet[];
};

type BankItem = {
  id?: string;
  text?: string;
  tags?: string[];
  claim_type?: string;
  confidence?: string;
  evidence?: Evidence;
  sources?: any;
};

type Inventory = {
  schema_version?: string;
  owner?: { name?: string };
  summary_bank?: { items?: BankItem[] };
  outcomes_bank?: { items?: BankItem[] };
  experience?: { items?: Experience[] };
  projects?: { items?: Project[] };
  skills?: { groups?: any[] };
};

type Stage = "idea_to_product" | "prelaunch_hardening" | "feature_ownership" | "architecture_review" | "general";

type Chunk = {
  id: string;
  text: string;
  tags: string[];
  source: string; // summary_bank | outcomes_bank | experience | projects | skills
  meta?: Record<string, any>;
  claim_type?: string;
  confidence?: string;
  evidence_ref?: string;
  stage_hints?: Stage[];
  weight?: number;
};

const DEFAULT_IN = "./inventory.json";
const DEFAULT_OUT = "./context.json";

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(p: string, obj: any) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function norm(s: string) {
  return s.toLowerCase();
}

function pickText(b: Bullet): string {
  return (b.text_short || b.text || b.text_long || "").trim();
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function asArray<T>(x: any): T[] {
  return Array.isArray(x) ? x : [];
}

function safeId(...parts: (string | undefined)[]) {
  const raw = parts.filter(Boolean).join("_");
  return raw.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
}

/**
 * Optional: stage hints improve retrieval precision by filtering/reranking by user intent.
 * Heuristic based on tags + keywords.
 */
function inferStageHints(text: string, tags: string[]): Stage[] {
  const t = norm(text);
  const tg = tags.map(norm);

  const hints: Stage[] = [];

  const has = (kw: string) => t.includes(kw) || tg.includes(kw);

  // Prelaunch hardening
  if (
    ["launch", "prelaunch", "alpha", "beta", "release", "incident", "oncall", "slo", "sla", "latency", "perf", "observability", "monitoring", "logging", "tracing", "load", "scaling"].some(has)
  ) hints.push("prelaunch_hardening");

  // Architecture review / audit
  if (
    ["audit", "security", "threat", "vulnerability", "exploit", "failure mode", "risk", "invariant", "auth", "permissions", "rbac", "abuse"].some(has)
  ) hints.push("architecture_review");

  // Feature ownership / shipping
  if (
    ["shipped", "implemented", "end-to-end", "ownership", "mvp", "feature", "product", "integration", "payments", "workflow"].some(has)
  ) hints.push("feature_ownership");

  // Idea to product
  if (
    ["prototype", "mvp", "founding", "0 to 1", "ideation", "cofounder"].some(has)
  ) hints.push("idea_to_product");

  if (hints.length === 0) hints.push("general");
  return uniq(hints);
}

function weightFromConfidenceAndClaim(conf?: string, claim?: string) {
  const c = norm(conf || "");
  const ct = norm(claim || "");
  const confW = c === "high" ? 3 : c === "medium" ? 2 : c === "low" ? 1 : 0;
  const claimW = ct === "metric" ? 3 : ct === "fact" ? 2 : ct ? 1 : 0;
  return confW * 10 + claimW * 2;
}

function pushChunk(chunks: Chunk[], chunk: Chunk) {
  if (!chunk.text || chunk.text.length < 3) return;
  chunk.tags = uniq(chunk.tags || []);
  chunk.stage_hints = uniq(asArray<Stage>(chunk.stage_hints || []));
  chunks.push(chunk);
}

function main() {
  const inPath = process.argv[2] || DEFAULT_IN;
  const outPath = process.argv[3] || DEFAULT_OUT;

  const inv = readJson<Inventory>(inPath);

  const chunks: Chunk[] = [];

  // summary_bank
  for (const it of asArray<BankItem>(inv.summary_bank?.items)) {
    const text = (it.text || "").trim();
    const tags = asArray<string>(it.tags);
    pushChunk(chunks, {
      id: safeId("summary", it.id || text.slice(0, 24)),
      text,
      tags,
      source: "summary_bank",
      claim_type: it.claim_type,
      confidence: it.confidence,
      evidence_ref: it.evidence?.ref,
      stage_hints: inferStageHints(text, tags),
      weight: weightFromConfidenceAndClaim(it.confidence, it.claim_type),
    });
  }

  // outcomes_bank
  for (const it of asArray<BankItem>(inv.outcomes_bank?.items)) {
    const text = (it.text || "").trim();
    const tags = asArray<string>(it.tags);
    pushChunk(chunks, {
      id: safeId("outcome", it.id || text.slice(0, 24)),
      text,
      tags,
      source: "outcomes_bank",
      claim_type: it.claim_type,
      confidence: it.confidence,
      evidence_ref: it.evidence?.ref,
      stage_hints: inferStageHints(text, tags),
      weight: weightFromConfidenceAndClaim(it.confidence, it.claim_type),
    });
  }

  // experience bullets
  for (const e of asArray<Experience>(inv.experience?.items)) {
    const expTags = uniq([
      ...(asArray<string>(e.tech_focus?.tags)),
    ]);

    const meta = {
      exp_id: e.id,
      org: e.org,
      role_title: e.role?.title,
      level: e.role?.level,
      phase: e.phase,
      dates: e.dates,
    };

    for (const b of asArray<Bullet>(e.bullets)) {
      const text = pickText(b);
      const tags = uniq([...(asArray<string>(b.tags)), ...expTags]);
      pushChunk(chunks, {
        id: safeId("exp", e.id, b.id || text.slice(0, 24)),
        text,
        tags,
        source: "experience",
        meta,
        claim_type: b.claim_type,
        confidence: b.confidence,
        evidence_ref: b.evidence?.ref,
        stage_hints: inferStageHints(text, tags),
        weight: weightFromConfidenceAndClaim(b.confidence, b.claim_type),
      });
    }
  }

  // project bullets
  for (const p of asArray<Project>(inv.projects?.items)) {
    const meta = {
      project_id: p.id,
      name: p.name,
      role_title: p.role?.title,
      dates: p.dates,
    };

    for (const b of asArray<Bullet>(p.bullets)) {
      const text = pickText(b);
      const tags = uniq(asArray<string>(b.tags));
      pushChunk(chunks, {
        id: safeId("proj", p.id, b.id || text.slice(0, 24)),
        text,
        tags,
        source: "projects",
        meta,
        claim_type: b.claim_type,
        confidence: b.confidence,
        evidence_ref: b.evidence?.ref,
        stage_hints: inferStageHints(text, tags),
        weight: weightFromConfidenceAndClaim(b.confidence, b.claim_type),
      });
    }
  }

  // skills (optional): flatten into chunks
  for (const g of asArray<any>(inv.skills?.groups)) {
    const name = String(g?.name ?? "").trim();
    const items = asArray<string>(g?.items);
    const text = name ? `${name}: ${items.join(", ")}` : items.join(", ");
    if (!text) continue;

    pushChunk(chunks, {
      id: safeId("skills", name || text.slice(0, 24)),
      text,
      tags: uniq([name, ...items]),
      source: "skills",
      stage_hints: inferStageHints(text, [name, ...items]),
      weight: 1,
    });
  }

  // Output object
  const out = {
    schema: "context_index",
    generated_at: new Date().toISOString(),
    source: {
      schema_version: inv.schema_version,
      inventory_file: path.basename(inPath),
    },
    stats: {
      chunks: chunks.length,
      sources: chunks.reduce<Record<string, number>>((acc, c) => {
        acc[c.source] = (acc[c.source] || 0) + 1;
        return acc;
      }, {}),
    },
    chunks,
  };

  writeJson(outPath, out);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${chunks.length} chunks to ${outPath}`);
}

main();