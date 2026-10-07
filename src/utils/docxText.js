// Plain text from a .docx (a zip holding word/document.xml), using the
// browser's own inflate (DecompressionStream) rather than a zip library.
const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

export async function docxText(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD) { end = i; break; }
  }
  if (end < 0) throw new Error('This isn’t a .docx file');
  const dec = new TextDecoder();
  let p = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0 && view.getUint32(p, true) === CENTRAL; n--) {
    const nameLen = view.getUint16(p + 28, true);
    if (dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)) === 'word/document.xml') {
      const local = view.getUint32(p + 42, true);
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + view.getUint32(p + 20, true));
      const xml = view.getUint16(p + 10, true) === 0 ? dec.decode(data)
        : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
      return xmlText(xml);
    }
    p += 46 + nameLen + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  throw new Error('No document text found in this .docx');
}

export const xmlText = xml => xml
  .replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>|<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/\n{3,}/g, '\n\n').trim();
