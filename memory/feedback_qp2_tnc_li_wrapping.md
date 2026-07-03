---
name: QP2 3.3 T&C uses <li> wrapping; QPRO uses <br><br>
description: QP2 3.3 Promotion Content stores T&C items as <li>…</li> list elements; QPRO stores them as inline paragraphs separated by <br><br>. Bulk patchers need separate anchor regex per platform.
type: feedback
originSessionId: faab1c01-8818-4987-850e-487dd5658e99
---
When writing a regex-based patcher that inserts/edits text inside a T&C section on `/api/bo/promotioncontent`, **the HTML structure differs between QPRO and QP2** even though the endpoint is the same.

**Why:** Both platforms share the endpoint but their content was authored independently and uses different wrapping conventions. A single anchor regex won't match both.

**How to apply:** For any bulk T&C edit:

| Platform | T&C item delimiter | Example anchor |
|---|---|---|
| QPRO | `<br><br>2.` (inline paragraphs) | `(&nbsp; &nbsp; - 918KISS<br>)` then insert before `<br><br>2.` |
| QP2 | `</li><li>` (HTML list) | `(<br>...918KISS)(</li>)` then insert before `</li>` |

QP2 also has a per-locale prefix difference:
- **QP2 EN** (locale_id 1/6): uses 3 `&nbsp;` before the dash (`&nbsp; &nbsp; &nbsp;- 918KISS`)
- **QP2 ZH** (locale_id 3/7): no leading spaces at all (`-918KISS`)

Safest pattern: capture the prefix dynamically from the existing anchor bullet and mirror it for the new line, rather than hardcoding a count of nbsp's. See `patchQp2Content` in `bin/add-qqpoker-to-rebate-tnc.mjs` for the prefix-detection regex.

WS1/WS2 (Directus `promotions_translations.content`) is a third format again — uses `<p>…</p>` wrappers and varies per region (some use dash bullets, IDN uses Roman numerals `i. ii. iii.`). See `patchBiaDashList` and `patchBiaRomanList` in the same script.
