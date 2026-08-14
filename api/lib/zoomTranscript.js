// zoom-meet-auto-ingest-v1, Step 3 - transcript download + WebVTT parsing.
//
// Neither recording.completed nor recording.transcript_completed embeds
// transcript text directly (confirmed live, both against Zoom's docs and by
// design: recording_files entries only ever carry a download_url). The
// payload's top-level download_token is a separate, one-time, 24h-expiring
// JWT - not the OAuth S2S access token client.js uses for API calls - so
// this is a plain authenticated fetch, not routed through callExternalApi
// (which assumes a registry-level credential, not a per-event token).
export async function downloadZoomTranscript(downloadUrl, downloadToken) {
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${downloadToken}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Zoom transcript download failed: ${res.status}`);
  return res.text();
}

// Zoom's TRANSCRIPT file is WebVTT: a "WEBVTT" header, then blocks of
// [cue number] / [start --> end timestamp] / [text, usually "Speaker: line"].
// This strips the header, cue numbers, and timestamps, keeping only the
// spoken text (with speaker labels Zoom already bakes into each cue).
export function parseVttToTranscript(vtt) {
  if (!vtt) return '';
  const blocks = vtt.replace(/\r\n/g, '\n').split(/\n\n+/);
  const lines = [];
  for (const block of blocks) {
    const blockLines = block.split('\n').filter(Boolean);
    if (!blockLines.length) continue;
    // Drop a leading "WEBVTT" header line and a leading pure-integer cue
    // number line, if present.
    let start = 0;
    if (/^WEBVTT/i.test(blockLines[0])) start = 1;
    if (blockLines[start] && /^\d+$/.test(blockLines[start].trim())) start++;
    // The next line, if it's a timestamp arrow, is the cue timing - drop it too.
    if (blockLines[start] && /-->/.test(blockLines[start])) start++;
    const text = blockLines.slice(start).join(' ').trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}
