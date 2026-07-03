---
name: Message template T&C item — hyperlink "Terms and Conditions"
description: Item 8 of the T&C list (or wherever "Terms and Conditions apply" lives) must hyperlink the words "terms and conditions" / "条款与条件" to the brand T&C page
type: feedback
originSessionId: ce9da079-4893-4a5f-b6d7-e0cbdd5fb420
---
The last T&C item in the inbox Message Template ("General :brandname Terms and Conditions apply." / "适用 :brandname 一般条款与条件。") must hyperlink the trailing "terms and conditions" / "条款与条件" text. Format differs by platform.

Reference: Directory sheet — `1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68` gid=1983898038.

### QPRO format

```html
<!-- EN locales (1, 6) -->
<li>General :brandname <a href="https://<brand-domain>/en-my/info-center/terms-and-conditions">terms and conditions</a> apply.</li>

<!-- ZH locales (3, 7) -->
<li>适用 :brandname 一般<a href="https://<brand-domain>/zh-my/info-center/terms-and-conditions">条款与条件</a>。</li>
```

- **No** `target="_blank"`.
- Domain is **hardcoded per brand** from the Directory sheet's Website Link column (e.g. QPRO4 → `ye55my.com`, QPRO15 → `e688my.com`, QPRO16 → `ed98my.com`, QPRO17 → `xe38.com`).
- Both MY and SG locales use `/en-my/` or `/zh-my/` (no `/en-sg/` subdomain — confirmed via the directory and live promo content).

### QP2 format

```html
<!-- EN locales (1, 6) -->
<li>General :merchantname <a target="_blank" href=":url/terms-conditions">Terms and Conditions</a> apply.</li>

<!-- ZH locales (3, 7) -->
<li>适用 :merchantname 一般<a target="_blank" href=":url/terms-conditions">条款与条件</a>。</li>
```

- **Always** `target="_blank"`.
- URL uses the `:url` placeholder — BO substitutes per merchant at display.
- **NO** `?lang=<LOCALE>` query param. Per operator 2026-05-20, the literal `:url/terms-conditions` is the canonical form per Directory; BO routes locale internally.
- **Title Case** "Terms and Conditions" (not lowercase).
- Earlier attempt added `?lang=` mirroring the QP2A EVEMGRTGA hardcoded link — wrong. Drop it.

### How to apply (mapper)

In `src/message-template-renderer.js`, update the last T&C `<li>` rendering:
- Lowercase "terms and conditions" (not Title Case).
- Wrap in `<a>` with the right format per platform.
- Look up the QPRO brand domain from the Directory or a hardcoded `BRAND_DOMAIN` map in `src/ingest.js` (mirror what's already there for siteId).
- For QP2, the `:url` placeholder is a single literal — no per-merchant lookup needed.

### Retroactive patch

`bin/_fix-msg-template-tnc-hyperlink.mjs` patches existing templates idempotently:
- Matches the existing item 8 EN (`General :brandname Terms and Conditions apply.`) or its already-hyperlinked variant.
- Matches the existing item 8 ZH (`适用 :brandname 一般条款与条件。`) or its hyperlinked variant.
- Replaces with the new hyperlinked form per platform.

### Locale → translation reference (Directory)

| Locale | "terms and conditions" translation |
|--------|-----------------------------------|
| EN | terms and conditions |
| ZH | 条款与条件 (or 条款及细则 — both seen; using 条款与条件 for now) |
| ID | syarat dan ketentuan |
| TH | ข้อกำหนดและเงื่อนไข |
| KH | ច្បាប់និងលក្ខខណ្ឌទូទៅរបស |

Same `<a href>` URL but the linked text changes per locale.
