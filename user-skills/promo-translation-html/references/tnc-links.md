# T&C URL Map — Brand × Locale × Target Language

Source of truth: the **TNC link** tab in the Directory sheet (Google Sheet `1AKFsxkNuFILj7Ge7jlq5aYlcEDTAvVsN4zWGftxmY68`, gid `1983898038`). Re-sync this file whenever those URLs change.

**Scope:** QPRO1–QPRO19 and QP2A–QP2D only. WS1, WS2, NX/UG, and other brands are explicitly out of scope until the user expands the ask.

Each cell is the brand's T&C page rendered in the named target language. Empty cell (`—`) means no URL exists for that combination — the skill must output the T&C heading as **plain text** (no hyperlink). Do NOT fall back to the EN version of the URL.

## QPRO

| Brand   | ZH (MY default) | ZH (SG) | TH | KM | ID |
|---------|-----------------|---------|----|----|----|
| QPRO1   | https://bp9mys.com/zh-my/info-center/terms-and-conditions | https://bp9mys.com/zh-sg/info-center/terms-and-conditions | — | — | https://bp9mys.com/id-id/info-center/terms-and-conditions |
| QPRO2   | https://12huatmy.com/zh-my/info-center/terms-and-conditions | https://12huatmy.com/zh-sg/info-center/terms-and-conditions | — | — | — |
| QPRO3   | https://bx99myr.com/zh-my/info-center/terms-and-conditions | https://bx99myr.com/zh-sg/info-center/terms-and-conditions | — | — | — |
| QPRO4   | — | — | — | — | — |
| QPRO5   | https://u388my.net/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO6   | https://wyn8my.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO7   | https://mbs66.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO8   | https://wild33.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO9   | https://mint33my.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO10  | https://uo8my.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO11  | — | — | — | — | — |
| QPRO12  | https://sbo18.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO13  | — | — | — | — | — |
| QPRO14  | — | — | — | — | — |
| QPRO15  | https://e688my.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO16  | https://ed98my.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO17  | https://xe38.com/zh-my/info-center/terms-and-conditions | — | — | — | — |
| QPRO18  | — | — | — | — | — |
| QPRO19  | — | — | — | — | — |

## QP2

| Brand | ZH (MY default) | ZH (SG) | TH | KM | ID |
|-------|-----------------|---------|----|----|----|
| QP2A  | https://ibc22myr.com/terms-conditions?lang=MY_ZH    | https://ibc22sgp.com/terms-conditions?lang=SG_ZH    | — | — | — |
| QP2B  | https://king333mys.com/terms-conditions?lang=MY_ZH  | https://king333sg.com/terms-conditions?lang=SG_ZH   | — | — | — |
| QP2C  | https://ace66my.co/terms-conditions?lang=MY_ZH      | https://ace66sg.com/terms-conditions?lang=SG_ZH     | — | — | — |
| QP2D  | https://spade66myr.com/terms-conditions?lang=MY_ZH  | https://spade66sg.com/terms-conditions?lang=SG_ZH   | — | — | — |

## Merchant-Name → Brand-Code Aliases

The skill identifies brands from the source title prefix (e.g. `BP9`, `IBC22`). Map those to brand codes before lookup:

| Merchant prefix (filename / title) | Brand code |
|------------------------------------|-----------|
| BP9                                | QPRO1     |
| 12huat / 12HUAT                    | QPRO2     |
| BX99                               | QPRO3     |
| YE55                               | QPRO4     |
| U388                               | QPRO5     |
| WYN8                               | QPRO6     |
| MBS66                              | QPRO7     |
| WILD33                             | QPRO8     |
| MINT33                             | QPRO9     |
| UO8                                | QPRO10    |
| (QPRO11 — merchant TBD)            | QPRO11    |
| SBO18                              | QPRO12    |
| (QPRO13 — merchant TBD)            | QPRO13    |
| (QPRO14 — merchant TBD)            | QPRO14    |
| E688                               | QPRO15    |
| ED98                               | QPRO16    |
| XE38                               | QPRO17    |
| POKIES / POKIESPALACE              | QPRO18    |
| OZPOKIES / OZPOKIES77              | QPRO19    |
| IBC22                              | QP2A      |
| KING333                            | QP2B      |
| ACE66                              | QP2C      |
| SPADE66                            | QP2D      |

If the merchant prefix isn't on this list → brand is **out of scope**, emit plain-text T&C heading.

## Selection Rules

1. **Locale defaults to MY.** Use the `ZH (MY)` / TH / KM / ID column unless the source promo doc clearly indicates SG (currency = SGD, title contains "SG", country listed as Singapore). In that case use the `ZH (SG)` column. SG variants for non-ZH locales aren't tracked here (out of scope).
2. **Language column = the target translation language**, not the source language.
   - Producing ZH HTML → use `ZH` column
   - Producing TH HTML → use `TH` column (almost always empty on QPRO/QP2 → plain text)
   - Producing KM HTML → use `KM` column (always empty on QPRO/QP2 → plain text)
   - Producing ID HTML → use `ID` column (only QPRO1 has one → plain text everywhere else)
   - Producing BM HTML → out of scope, always plain text
3. **No URL → plain-text heading** (no hyperlink). Do not fall back to EN URL.
4. **Not a QPRO/QP2 brand** → plain-text heading. Do not hyperlink.
5. **QPRO18 / QPRO19** are Australian-EN brands; they shouldn't appear in this skill's translation flow anyway.

## Notes

- QPRO4, QPRO11, QPRO13, QPRO14 — ZH URLs not registered on the source sheet yet. Output plain text and flag in the final report.
- Re-sync trigger: anytime the user mentions T&C URL changes, new brand additions, or asks to "refresh the T&C map", re-read the TNC link tab and update this file.
