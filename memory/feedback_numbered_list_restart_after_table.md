---
name: Numbered list restart after table — fix post-table items
description: When a Drive doc has a list split by a table, the second list segment resets to 1. After pipeline conversion, check for incorrect list restarts and fix with targeted text replacement.
type: feedback
originSessionId: a31ede4f-1d05-4976-a033-a57703302ce0
---
## Rule

Google Docs sometimes uses two separate `<ol>` blocks when a table interrupts a numbered list. After the `fetchDocHtml` pipeline converts lists to plain text (e.g. `1. Item`, `2. Item`), the post-table block restarts numbering from 1 instead of continuing (e.g. 3, 4).

**Detection:** After pipeline, check the content around `</table>` for `<br><br>1.` — if items labeled 1/2 appear after the table but they are clearly continuations of a pre-table list (e.g. items 1+2 exist before the table), they are incorrectly numbered.

**Fix:** Apply targeted exact-string replacement on the specific item text. Example from B46 BP9:
```js
// EN
content = content
  .replace('<br><br>1. The more tickets you collect...', '<br><br>3. The more tickets you collect...')
  .replace('<br><br>2. Lucky winners will be contacted...', '<br><br>4. Lucky winners will be contacted...');

// ID_ID
content = content
  .replace('<br><br>1. Semakin banyak tiket...', '<br><br>3. Semakin banyak tiket...')
  .replace('<br><br>2. Pemenang beruntung...', '<br><br>4. Pemenang beruntung...');

// ZH (entity-encoded)
content = content
  .replace('<br><br>1. &#25277;&#22870;...', '<br><br>3. &#25277;&#22870;...')
  .replace('<br><br>2. &#27963;&#21160;...', '<br><br>4. &#27963;&#21160;...');
```

**Why:** B46 BP9 "Mid-Year Spend & Win" — the 4-item How to Participate list had items 1+2 before the deposit-amount table and items 3+4 after. The `<ol>` conversion reset the counter, making items 3+4 appear as 1+2 again.

**How to apply:** After running `fetchDocHtml`, scan content near `</table>` for `<br><br>1.` patterns. If the doc has a list-table-list structure, apply exact-string renumbering for each locale's continuation items.
