export function getCallContext(call, maxChars = 1500) {
  if (!call) return "";
  const text = call.rawTranscript ?? call.structuredNotes ?? call.summary ?? "";
  if (!text) return "";
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}
