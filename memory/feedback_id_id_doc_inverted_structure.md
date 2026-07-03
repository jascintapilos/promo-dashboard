---
name: ID/ID Drive doc — inverted structure (Indonesian before <hr>)
description: ID/ID locale docs have Indonesian content BEFORE the first <hr> and English reference copy AFTER. Take only the pre-<hr> section; discard everything after.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
## Rule

ID/ID Drive docs are structured as:

```
[Indonesian content — full body + rules + T&C]
<hr>
[English reference copy]                         ← discard this
```

This is the **opposite** of EN docs where the main content follows the header. The standard `fetchDocHtml` pipeline strips everything **before** the first `<hr>` (treating it as the header block) — that logic **must NOT** be applied to ID/ID docs; it would discard the real content.

**Correct approach for ID/ID docs:**
1. Apply the full `fetchDocHtml` cleanup pipeline (style strip, attr strip, list conversion, p→`<br><br>`, etc.)
2. Split at `html.search(/<hr/i)` — take `html.slice(0, firstHr)` (the Indonesian section)
3. Then apply ZH-style title/tagline strip: `segs = html.split('<br><br>'); content = segs.slice(2).join('<br><br>')`
4. Extract description from the second non-empty `<p>` text **before** the pipeline collapses paragraphs

**Why:** B46 BP9 "BP9 Mid-Year Spend & Win ID/ID" doc: the English block after `<hr>` was being used as the ID_ID content because the standard pipeline stripped the Indonesian block.

**How to apply:** When fetching any ID/ID-locale doc from Drive, split at first `<hr>` and keep ONLY the pre-`<hr>` half. See `bin/fetch-b46-id-doc.mjs` as the reference implementation.
