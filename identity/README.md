# Tanbeeh identity

The Tanbeeh brand kit: the "Almost ready" logo, colours and type, all taken from the website's Ember theme (`frontend/packages/ui/src/ember.css`).

| Folder / file | What's inside | Use it for |
|---|---|---|
| `Tanbeeh-Brand-Guidelines.pdf` | 12-page brand book: idea, logo versions, construction, misuse, colour, type, app icon, print | Sharing with designers, printers, partners |
| `guidelines-pages/` | The same 12 pages as PNG images | WhatsApp, slides, quick previews |
| `logo/svg/` | Mark and symbol in every colour version, as vectors | Web, design tools |
| `logo/png/` | Every version at 256–2048 px, plus the logo with the name in English and Arabic (dark and white) at 128–512 px tall, transparent background | Documents, presentations, anywhere an image is needed |
| `logo/pdf/` | Vector PDFs of every version, including the logo with the name | **Print**: send these to printers |
| `app-icons/` | App Store 1024, Play Store 512, PWA 192/512, Apple touch 180, favicons 16–96 + SVG, Android notification badge 72/96 | App stores, website, phone |
| `social/` | Profile avatar (dark and light), share image 1200×630 and cover banner 1500×500 in English and Arabic | Instagram, Facebook, LinkedIn, X, link previews |
| `colors/` | Palette image, `tanbeeh-colors.css`, `tanbeeh-colors.json` (hex, RGB, approximate CMYK) | Developers and designers |
| `source/` | The script that builds everything above | Regenerating after a change |

## Regenerate

Everything is generated from code, so a change to the mark or colours is one command (needs `frontend/` installed):

```bash
node identity/source/build-identity.mjs
```

Geometry and colours live in `source/brand.mjs`, and must match `frontend/packages/ui/src/BrandMark.tsx` and `ember.css`. The guidelines pages are in `source/guidelines.mjs`.

## Notes

- CMYK values are mathematical conversions. Ask the printer for a proof against the hex and RGB values.
- The `logo/svg/` files contain only shapes. The versions with the name are PNG and PDF only, because an SVG would need the Alexandria font installed to show the name.
- The QR codes, venue names and copy shown in the guidelines' mock-ups are samples.
