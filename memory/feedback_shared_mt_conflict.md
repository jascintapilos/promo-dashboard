# Feedback: Shared message template conflict resolution

When two promo codes point to the same message_template_id and the fix changes one:
1. Check if the other promo sharing the template is the same catType (LC/Slots/all-games)
2. If YES → both use the same clause → sharing is fine, no action needed
3. If NO → sharing is NOT fine → create a dedicated MT for the code whose catType differs:
   a. Clone from a same-code template on another brand/site (preferred — same params)
   b. POST new MT shell to target site → PUT with content
   c. PUT promotion to link new MT using correct QPRO promotion PUT body shape (see session_2026-05-27)
