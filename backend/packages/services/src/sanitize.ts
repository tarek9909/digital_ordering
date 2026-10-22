// Allow-list HTML sanitiser for platform-published legal documents (W12, FR-SA-12). The output is rebuilt from
// tokens: only the listed tags survive, without attributes (except an https/mailto link target), all other markup
// is dropped, the contents of script/style/iframe/template elements are removed, and text is re-escaped. Apps may
// then render the result as HTML.

const ALLOWED = new Set(['p', 'br', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'u', 'a', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'section', 'small']);
const VOID = new Set(['br', 'hr']);
const DROP_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript', 'svg', 'math', 'head', 'title']);

const escapeText = (s: string) =>
  s
    // keep well-formed entities, escape everything else
    .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]{1,31}|#\d{1,7}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function safeHref(attrs: string): string | null {
  const m = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs);
  const raw = (m?.[2] ?? m?.[3] ?? m?.[4] ?? '').trim();
  const decoded = raw.replace(/&amp;/g, '&');
  return /^(https:\/\/|mailto:)[^\s<>"'`]+$/i.test(decoded) ? decoded : null;
}

export function sanitizeLegalHtml(input: string): string {
  const out: string[] = [];
  const open: string[] = [];
  let skipping: string | null = null;
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<!doctype[^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+(?:[^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/gi;
  let last = 0;
  for (let m = re.exec(input); m; m = re.exec(input)) {
    const text = input.slice(last, m.index);
    last = re.lastIndex;
    if (!skipping && text) out.push(escapeText(text));
    const tag = m[1]?.toLowerCase();
    if (!tag) continue; // comment, CDATA or doctype
    const closing = m[0].startsWith('</');
    if (skipping) {
      if (closing && tag === skipping) skipping = null;
      continue;
    }
    if (DROP_CONTENT.has(tag)) {
      if (!closing && !m[0].endsWith('/>')) skipping = tag;
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const i = open.lastIndexOf(tag);
      if (i === -1) continue;
      while (open.length > i) out.push(`</${open.pop()}>`);
      continue;
    }
    if (VOID.has(tag)) {
      out.push(`<${tag}>`);
      continue;
    }
    if (tag === 'a') {
      const href = safeHref(m[2] ?? '');
      out.push(href ? `<a href="${escapeText(href)}" rel="noopener noreferrer" target="_blank">` : '<a>');
    } else out.push(`<${tag}>`);
    open.push(tag);
  }
  if (!skipping) out.push(escapeText(input.slice(last)));
  while (open.length) out.push(`</${open.pop()}>`);
  return out.join('');
}
