const encoder = new TextEncoder();

function encodeSseData(data: string) {
  return encoder.encode(`data: ${data}\n\n`);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSseData(record: string) {
  return record
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
}

function buildPublicSseData(data: string) {
  const parsed = parseJson(data);
  if (!isRecord(parsed)) return data;

  const publicData: Record<string, unknown> = {};

  if (typeof parsed.response === "string") {
    publicData.response = parsed.response;
  }
  if (parsed.usage !== undefined) {
    publicData.usage = parsed.usage;
  }

  if (Object.keys(publicData).length === 0) return null;
  if (publicData.response === "" && !("usage" in publicData)) return null;

  return JSON.stringify(publicData);
}

function logSseData(data: string) {
  const parsed = parseJson(data);
  if (!isRecord(parsed)) return;

  console.log(
    "[ai-stream:sse-data]",
    JSON.stringify({ keys: Object.keys(parsed) }),
  );
}

export function createPublicAiStream(
  source: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();

  let buffer = "";
  let doneSent = false;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = source.getReader();

      const emitDone = () => {
        if (doneSent) return;

        controller.enqueue(encodeSseData("[DONE]"));
        doneSent = true;
      };

      const emitRecord = (record: string) => {
        const data = parseSseData(record.trim());
        if (!data) return;

        if (data === "[DONE]") {
          emitDone();
          return;
        }

        logSseData(data);
        const publicData = buildPublicSseData(data);
        if (!publicData) return;

        controller.enqueue(encodeSseData(publicData));
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

        if (buffer.trim()) {
          emitRecord(buffer);
        }

        // Guarantees a predictable public protocol even if the upstream
        // provider closes the stream without sending [DONE].
        emitDone();

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
