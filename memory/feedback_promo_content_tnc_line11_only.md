---
name: 3.3 Promo content T&C hyperlink = sentence 11 only
description: In QPRO 3.3 Promotion Content bodies, only sentence 11 "General :brandname terms and conditions apply." is hyperlinked — not every occurrence.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
In the HTML content body of a 3.3 Promotion Content entry, the T&C hyperlink rule is:

**Only sentence 11** — `General :brandname terms and conditions apply.` — gets the `<a href>` link.
All other occurrences of "terms and conditions" in the body must NOT be linked.

The `<strong>Terms and Conditions</strong>` section heading must also remain unlinked.

**EN pattern:**
```
General :brandname <a href="{tncUrl}">terms and conditions</a> apply.
```

**ZH pattern (entity form):**
```
:brandname &#19968;&#33324;<a href="{tncUrl}">&#26465;&#27454;&#19982;&#26465;&#20214;</a>&#21516;&#26679;&#36866;&#29992;&#12290;
```

**Correct fix approach:** strip all existing `<a>` links wrapping the T&C text first, then re-add only on sentence 11. Never link-all-then-skip-heading.

**Why:** The first round of T&C fixing linked every occurrence (3 links per locale). User corrected: only sentence 11 should be hyperlinked.

**How to apply:** When generating or patching 3.3 content body T&C sections, use the strip-then-add-line-11-only approach (see `bin/fix-bp9-b46-content2.mjs` `fixTnCLine11EN` / `fixTnCLine11ZH`).
