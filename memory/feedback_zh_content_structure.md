---
name: ZH promo content — title/description/body structure
description: How to extract title, description, and content body from ZH Drive docs (no <hr> separator). Confirmed 2026-05-21 on B46 BP9 ZH.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
ZH Drive docs typically have no `<hr>` separator, so `fetchDocHtml` does not auto-strip the header. The raw content body therefore starts with:

```
<strong>BRAND TITLE</strong><br><br>TAGLINE<br><br>REAL BODY...
```

**Correct split:**
- `title` field = first `<strong>...</strong>` decoded — **keep the full brand prefix** (e.g. "BP9 年中消费抽奖大放送", NOT "年中消费抽奖大放送")
- `description` field = second `<br><br>` segment (the tagline), decoded
- `content` field = everything from the third `<br><br>` segment onwards (strip the first two segments)

**Example (B46 BP9 Mid-Year Spend & Win):**
- title: `BP9 年中消费抽奖大放送`
- description: `都说时间不等人——但在 BP9，时间会犒赏勇于出手的人。`
- content starts: `当 2026 年走到中点，BP9 正在重新定义奢华标准。我们不仅为你的科技装备焕新…`

**EN title also needs the brand prefix** (e.g. "BP9 Mid-Year Spend & Win", NOT "Mid-Year Spend & Win"). Same rule: keep the full brand name as part of the title for all locales — EN, ZH, and ID.

**Why:** The brand name prefix (e.g. "BP9") is part of the displayed promotion title on the front end. Stripping it makes the title inconsistent with how the brand names its campaigns. The tagline and body must be in separate fields so BO displays them correctly.

**How to apply:** After `fetchDocHtml` on a ZH doc (or when manually setting ZH locale fields):
1. Extract title from first `<strong>` block — decode entities, do NOT strip brand prefix
2. Extract description from second `<br><br>` segment — decode entities
3. Strip first two segments from content so body starts with the actual paragraph text
4. For EN locales: set title to full brand + promo name (e.g. "BP9 Mid-Year Spend & Win") — same brand-prefix rule applies
