---
name: 3.3 Promo content title + description must be HTML-entity decoded
description: fetchDocHtml pipeline stores raw HTML entities in title and description fields. Always decode before PUT or the BO renders literal &mdash; etc.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
The `fetchDocHtml` pipeline outputs HTML entities verbatim into `title` and `description` fields (e.g. `&mdash;`, `&ndash;`, `&amp;`, `&#NNNNN;`, `&nbsp;`). The QPRO BO renders these as literal text rather than the intended Unicode characters.

**Always run `decodeEntities()` on title and description values before storing them via PUT.**

Minimum decode map:
```js
str.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
   .replace(/&mdash;/g,  '—')
   .replace(/&ndash;/g,  '–')
   .replace(/&amp;/g,    '&')
   .replace(/&nbsp;/g,   ' ')
   .replace(/&rsquo;/g,  '’')
   .replace(/&ldquo;/g,  '“')
   .replace(/&rdquo;/g,  '”')
```

**Affected fields:** `title`, `description`. Do NOT decode `content` (the HTML body) — entities inside HTML attributes and tags must remain encoded.

**Also applies when extracting description from raw HTML pipeline output** (e.g. pulling tagline text from a `<p>` element before the HTML is collapsed). The `.replace(/<[^>]+>/g, '')` tag-strip does NOT decode entities — run `decodeEntities()` on the resulting text string before storing.

**Why:** B46 BP9 Mid-Year Spend & Win descriptions stored as `"They say time waits for no one&mdash;but at BP9..."`. BO displayed it as literal `&mdash;` text in the promo card subtitle. Same issue appeared when extracting the ID_ID description directly from Drive HTML export.

**How to apply:** In upload-promo.js and any fix script that writes title/description, wrap values with `decodeEntities()` before assignment. Also decode in any doc-fetch script that extracts description text from the HTML pipeline output.
