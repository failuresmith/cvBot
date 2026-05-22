export type Tone = "technical" | "non-technical";
export type ChatRole = "user" | "assistant";

export type ClientMessage = {
  role: ChatRole; // client may only send user/assistant
  content: string;
};

export type ChatRequest = {
  tone?: Tone;
  history?: ClientMessage[];
  message: string; // current user message
};

export type Chunk = {
  id: string;
  text: string;
  tags?: string[];
  source?: string;
  claim_type?: string;
  confidence?: string;
  evidence_ref?: string;
  stage_hints?: string[];
  weight?: number;
  meta?: Meta;
};

export type Meta = {
  name?: string;
  exp_id?: string;
  org?: string;
  role_title?: string;
  level?: string;
  phase?: string;
  dates: {
    start?: string;
    end?: string;
  };
};

export type Index = {
  schema: string;
  chunks: Chunk[];
};
