---
name: Inbox T&C — QPRO hyperlinked per brand; QP2 plain text + :url placeholder
description: Point 8 of the deposit inbox T&C list. QPRO injects a brand-specific hyperlink at render time using brand-directory's tncDomain. QP2 stays plain text with :url/terms-conditions placeholder for BO display-time substitution.
type: feedback
originSessionId: 4a20c38b-f96f-4db9-b996-21a1cb1fbc5b
---
Operator rule (2026-05-20). Body files are authored with QP2's plain-text form. The renderer applies a QPRO-only post-process that converts the line to a hyperlink, while QP2 passes through unchanged.

**Body file authoring (`src/message-template-bodies/deposit/{EN,ZH,ID}.html`):**

```
EN: <li>General :brandname Terms and Conditions apply.  :url/terms-conditions</li>
ZH: <li>适用 :brandname 一般条款与条件。  :url/terms-conditions</li>
ID: <li>Syarat dan Ketentuan umum :brandname berlaku.  :url/terms-conditions</li>
```

**QPRO output (per `hyperlinkQproTnc` in `src/message-template-renderer.js`):**

```
EN: <li>General :brandname <a href="<tncDomain>/en-my/info-center/terms-and-conditions">Terms and Conditions</a> apply.</li>
ZH: <li>适用 :brandname 一般<a href="<tncDomain>/en-my/info-center/terms-and-conditions">条款与条件</a>。</li>
ID: <li>Syarat dan Ketentuan umum :brandname berlaku.</li>
```

`<tncDomain>` comes from `data/brand-directory.json` per-brand `tncDomain` field (probed live 2026-05-20). Same URL for all locales (no `/zh-my/` variant — matches operator-edited live template QPRO4#325). No `target="_blank"`.

**QP2 output:** body passes through verbatim. `:brandname` → `:merchantname` (per the existing platform-swap pass). The literal `:url/terms-conditions` stays — QP2 BO substitutes `:url` to the merchant domain at display time. Same template body works for all 4 QP2 merchants on the shared `ibc22.qtp777.com` BO.

**Why split:** QPRO has per-brand BO so the brand identity is known at render time and we can hardcode the hyperlink. QP2 has a shared BO serving 4 merchants; `:url` substitution at display time keeps the template merchant-agnostic.

**How `hyperlinkQproTnc` works:** scoped to the `<li>` that contains `:url/terms-conditions`. Replaces the localized term inside that `<li>` only (avoids accidentally matching the same term in section headers like ZH's `<p><strong>条款与条件（摘要）</strong></p>`), then strips the placeholder. Idempotent.

**Brand directory tncDomain map (probed 2026-05-20, see `data/brand-directory.json`):**

| Brand | tncDomain |
|---|---|
| QPRO1 BP9     | bp9mys.com |
| QPRO2 12HUAT  | 12huatmy.com |
| QPRO3 BX99    | bx99myr.com |
| QPRO4 YE55    | ye55my.com |
| QPRO5 U388    | u388my.net |
| QPRO6 WYN8    | wyn8my.com |
| QPRO7 MBS66   | mbs66.com |
| QPRO8 WILD33  | wild33.com |
| QPRO9 MINT33  | mint33my.com |
| QPRO10 UO8    | uo8my.com |
| QPRO12 SBO18  | sbo18.com |
| QPRO15 E688   | e688my.com |
| QPRO16 ED98   | ed98my.com |
| QPRO17 XE38   | xe38.com |
| QP2A IBC22    | ibc22myr.com (kept as reference; QP2 uses :url placeholder) |
| QP2B KING333  | king333mys.com (kept as reference) |
| QP2C ACE66    | ace66my.co (kept as reference) |
| QP2D SPADE66  | spade66myr.com (kept as reference) |

**Verified 2026-05-20:** all 12 P091-P096 templates have the correct form. QPRO4 EN/ZH hyperlinked; QP2C all locales plain text with `:url`. `bin/fix-p091-p096-message-template.mjs` re-renders + PUTs.

**2026-06-11 FS templates added:** `src/message-template-bodies/free-spin/{EN,ZH,ID}.html` now include `:url/terms-conditions` (same portable form as Deposit/FC). Renderer converts for QPRO automatically. When patching existing templates via direct API (not renderer), apply the convention manually — QPRO gets `<a href>` wrapping the term, QP2 gets `:url/terms-conditions` after the sentence. `bin/fix-fs-mt-tnc.mjs` (QP2) and `bin/fix-fs-mt-tnc-qpro.mjs` (QPRO) are the reference one-shot scripts.

**QP2 messagetemplate PUT quirk:** omit the `code` field on PUT — sending it triggers 422 "code already been taken". QPRO PUT accepts `code` without issue.
