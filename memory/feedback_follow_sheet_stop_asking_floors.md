---
name: follow-sheet-stop-asking-floors
description: "When source sheet specifies values below documented platform floors (e.g. FS min 0.50/spin, min dep 100), follow the sheet — do not stop to escalate every deviation."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

When the source request sheet specifies values that deviate from documented platform floors (FS spin value < 0.50, min deposit < 100, etc.), **follow the sheet spec** without stopping to ask.

**Why:** Operators (Claudia, Wai Yip) know when they're intentionally overriding platform defaults. Every ask blocks the pipeline and adds friction they've already accepted. If a floor deviation is a real problem, they'll surface it before requesting. Asking each time treats them as unaware, which they're not.

**How to apply:**
- Sheet says value_per_spin 0.40? Save 0.40. Don't ask.
- Sheet says min_deposit 50? Save 50. Don't ask.
- Sheet says rounds 100 (vs 88 platform max)? Save 100. Don't ask.
- **Still flag once in the summary table** so the operator sees you noticed, but don't gate on their sign-off — proceed.
- Exceptions where you SHOULD still stop: values that make the save physically impossible (currency mismatch, missing required field), or values that would cause a 422 rejection at the BO API layer.

Related: [[promo-request-sheet-current-month]], [[fs-general-rules]].
