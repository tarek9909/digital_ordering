# 0005 — Hand-written email-safe HTML layout

**Context.** TR-EML-01 asks for templates written in MJML and compiled at build time. MJML pulls a large dependency tree into the worker for a single, fixed layout.

**Decision.** `packages/services/src/emails.ts` holds one table-based, inline-styled layout. This is the same kind of HTML that MJML produces. Texts are in Arabic and English, and every email includes a plain-text alternative. All values are HTML-escaped.

**Consequences.** Console-editable texts (TR-EML-03, R1.1) replace the text blocks, not the layout, so this decision does not affect them.
