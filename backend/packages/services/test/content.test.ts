import { describe, expect, it } from 'vitest';
import { EMAIL_TEMPLATES } from '../src/email.js';
import { renderEmail } from '../src/emails.js';
import { sanitizeLegalHtml } from '../src/sanitize.js';

describe('legal HTML sanitiser (W12)', () => {
  it('keeps document structure and safe links', () => {
    expect(sanitizeLegalHtml('<h2 class="x">Data</h2><p>We keep <strong>nothing</strong>.</p><ul><li>a</li></ul>')).toBe('<h2>Data</h2><p>We keep <strong>nothing</strong>.</p><ul><li>a</li></ul>');
    expect(sanitizeLegalHtml('<a href="https://example.com/p?a=1&amp;b=2" onclick="x()">site</a>')).toBe('<a href="https://example.com/p?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">site</a>');
  });

  it('removes scripts, handlers, unsafe URLs and unknown tags', () => {
    expect(sanitizeLegalHtml('<p>a<script>alert(1)</script>b</p>')).toBe('<p>ab</p>');
    expect(sanitizeLegalHtml('<img src=x onerror=alert(1)><p onmouseover="x">t</p>')).toBe('<p>t</p>');
    expect(sanitizeLegalHtml('<a href="javascript:alert(1)">x</a><a href=" JaVaScRiPt:alert(1)">y</a>')).toBe('<a>x</a><a>y</a>');
    expect(sanitizeLegalHtml('<style>p{}</style><iframe src="https://e"></iframe>ok')).toBe('ok');
    expect(sanitizeLegalHtml('1 < 2 & "q"')).toBe('1 &lt; 2 &amp; &quot;q&quot;');
  });

  it('closes what it opened and ignores stray closing tags', () => {
    expect(sanitizeLegalHtml('<p><strong>x</p></em>')).toBe('<p><strong>x</strong></p>');
  });
});

describe('email templates in Arabic (W07, FR-ADM-19)', () => {
  it('has an Arabic, right-to-left version of every template', () => {
    for (const t of EMAIL_TEMPLATES) {
      const r = renderEmail(t, 'ar', { name: 'سارة', tenantName: 'مطعم', link: 'https://x', reason: 'r', url: 'https://w', newEmail: 'n@x.test', venue: 'فرع', from: '2026-10-11', to: '2026-10-17', tickets: 10, previousTickets: 8 });
      expect(r.html, t).toContain('dir="rtl"');
      expect(/[؀-ۿ]/.test(r.subject), `${t} subject`).toBe(true);
    }
  });

  it('writes the weekly summary from figures in the reader language', () => {
    const data = { venue: 'Main', from: '2026-10-11', to: '2026-10-17', tickets: 120, previousTickets: 100, reachPct: 91, ackPct: 80, pickupSeconds: 75 };
    expect(renderEmail('weekly_summary', 'en', data).text).toContain('Tickets: 120 (previous week 100)');
    expect(renderEmail('weekly_summary', 'ar', data).text).toContain('التذاكر: 120');
  });
});
