// Legal documents are typed as plain text and stored as HTML (the site and apps show the HTML, sanitised by the server).
// Blank line = new paragraph, "# " = heading, "## " = smaller heading, "- " = list item.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function textToHtml(text: string): string {
  const out: string[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushList = () => {
    if (list.length) out.push(`<ul>${list.map((i) => `<li>${i}</li>`).join('')}</ul>`);
    list = [];
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
    para = [];
  };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    const h = /^(#{1,2})\s+(.*)$/.exec(line);
    const li = /^[-*•]\s+(.*)$/.exec(line);
    if (!line) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      const tag = h[1] === '#' ? 'h2' : 'h3';
      out.push(`<${tag}>${esc(h[2] ?? '')}</${tag}>`);
    } else if (li) {
      flushPara();
      list.push(esc(li[1] ?? ''));
    } else {
      flushList();
      para.push(esc(line));
    }
  }
  flushPara();
  flushList();
  return out.join('\n');
}

export function htmlToText(html: string): string {
  if (!html.trim()) return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks: string[] = [];
  const inline = (el: Element) => (el.innerHTML.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'h1' || tag === 'h2') blocks.push(`# ${inline(el)}`);
    else if (/^h[3-6]$/.test(tag)) blocks.push(`## ${inline(el)}`);
    else if (tag === 'ul' || tag === 'ol') blocks.push(Array.from(el.children).map((li) => `- ${inline(li)}`).join('\n'));
    else if (inline(el)) blocks.push(inline(el));
  }
  return blocks.join('\n\n');
}
