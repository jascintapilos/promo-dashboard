---
name: subagent-design-principles
description: "How to design sub-agent fan-out so isolated helpers don't botch judgment calls — restrict them to read-only mechanical/semantic checks, keep decisions on main thread."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: d1eb0e77-230d-47b2-80c0-6e8850271078
---

User raised this concern 2026-06-22 while designing the post-save deep-QC pattern (see [[project_parallel_qc_deep_qc]]): "what i worry about is when one agent doesnt know everything when there are mistakes". The worry is valid — sub-agents work in isolation, can't ask follow-ups, and may confidently give wrong answers when something unexpected happens.

**Why:** Sub-agents only know what's in their prompt. They lack the accumulated nuance built up in main-thread memory (TEST_ prefix rules, blacklist "& vs +" splitter, QPRO archive not freeing codes, currency_id mixups, etc.). A confident wrong answer is worse than a slow correct one.

**How to apply** (the rules we settled on for this codebase):

1. **Sub-agents do fact-finding, not decisions.** They fetch + report. The "what should we do about it" call stays on main thread where all the memory rules are loaded.
2. **Prompt them to flag, not fix.** Every helper prompt should say "If anything looks ambiguous or off-pattern, surface it — don't make a judgment call." A helper that says "I'm not sure" beats ten that confidently get it wrong.
3. **Don't sub-agent the gnarly stuff.** Field parsing rules, naming conventions, dialog mis-link by site_id, QPRO PUT wiping promotion_currency — keep on main thread.
4. **Best fit: read-only mechanical/semantic checks where the right answer is unambiguous given the input.** Duplicate-code probes, post-save numeric mechanics verification, BO endpoint health, T&C wording checks.
5. **Include known false-positive lists in the sub-agent prompt.** For deep-QC: empty `member_group_ids` on QPRO is intentional, null `max_total_*` on QP2 = Unlimited, etc. Without this, sub-agents cry wolf.
6. **Structured returns over free-form.** Force JSON with pass/warn/fail + findings + evidence so main thread can sanity-check.

The user prefers caution here — only ship sub-agent fan-out for cases where the worst outcome is a false alarm (read-only). Anything that could *break a save* stays on main thread.

Related: [[feedback_scope_check]], [[feedback_simplify_workflows]].
