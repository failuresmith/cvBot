const encoder = new TextEncoder();

export const CONTACT_DETAILS = {
  email: "miladtsx@gmail.com",
  telegram: "https://t.me/sebaesar",
  booking: "https://cal.com/sebaesar/intro",
} as const;

export const CONTACT_DETAILS_RESPONSE = [
  `Email: ${CONTACT_DETAILS.email}`,
  `Telegram: ${CONTACT_DETAILS.telegram}`,
  `Booking: ${CONTACT_DETAILS.booking}`,
].join("\n");

function normalizeMessage(message: string) {
  return message.toLowerCase().replace(/\s+/g, " ").trim();
}

export function isContactDetailsRequest(message: string) {
  const normalized = normalizeMessage(message);
  if (!normalized) return false;

  return [
    /\bcontact\s+(details?|info(?:rmation)?|options?)\b/,
    /\bhow\s+(can|do|should)\s+i\s+(contact|reach|message|dm|get\s+in\s+touch)\s+(you|milad)\b/,
    /\bwhere\s+(can|do)\s+i\s+(contact|reach|message|dm|email)\s+(you|milad)\b/,
    /\b(can|could)\s+(i|we)\s+(contact|reach|message|dm|email)\s+(you|milad)\b/,
    /\b(your|milad'?s)\s+(email|e-mail|telegram|cal\.?com|calendar|booking\s+link|contact)\b/,
    /\b(book|schedule)\s+(a\s+)?(call|meeting)\s+(with\s+)?(you|milad)\b/,
    /^(email|e-mail|telegram|cal\.?com|booking|booking link|calendar)\??$/,
  ].some((pattern) => pattern.test(normalized));
}

export function createStaticAiStream(response: string): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ response })}\n\n`),
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
