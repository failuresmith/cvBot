const encoder = new TextEncoder();

type PublicAiStreamEvent = {
  response?: string;
  usage?: unknown;
};

function encodeSseData(data: string) {
  return encoder.encode(`data: ${data}\n\n`);
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function publicAiStreamEvent(raw: unknown): PublicAiStreamEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const event = raw as Record<string, unknown>;
  const out: PublicAiStreamEvent = {};
  const hasUsage = "usage" in event;

  if (typeof event.response === "string" && (event.response || hasUsage)) {
    out.response = event.response;
  }
  if (hasUsage) {
    out.usage = event.usage;
  }

  return "response" in out || "usage" in out ? out : null;
}

function parseSseData(record: string) {
  return record
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

export function createPublicAiStream(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();

      const emitRecord = (record: string) => {
        const data = parseSseData(record.trim());
        if (!data) return;

        if (data === "[DONE]") {
          controller.enqueue(encodeSseData("[DONE]"));
          return;
        }

        const parsed = parseJsonString(data);
        const publicEvent = publicAiStreamEvent(parsed);
        if (!publicEvent) return;

        controller.enqueue(encodeSseData(JSON.stringify(publicEvent)));
      };

      const emitCompleteRecords = () => {
        buffer = buffer.replace(/\r\n/g, "\n");

        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          emitRecord(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          emitCompleteRecords();
        }

        buffer += decoder.decode();
        if (buffer.trim()) emitRecord(buffer);
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
