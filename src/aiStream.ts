const encoder = new TextEncoder();

type UpstreamAiStreamEvent = {
  choices?: Array<{
    delta?: {
      content?: unknown;
      reasoning?: unknown;
    };
  }>;
};

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

function parseSseData(record: string) {
  return record
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
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

        const parsed = parseJson(data);
        if (!parsed || typeof parsed !== "object") return;

        const event = parsed as UpstreamAiStreamEvent;
        const content = event.choices?.[0]?.delta?.content;

        // Publish visible answer tokens only.
        // Drop reasoning, usage, provider metadata, and unknown fields.
        if (typeof content !== "string" || content.length === 0) return;

        controller.enqueue(
          encodeSseData(
            JSON.stringify({
              response: content,
            }),
          ),
        );
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
