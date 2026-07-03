# Feedback: Post-save QC is mandatory

After every promo code creation (any platform, any bonus type), automatically run QC against the original request template for:
- BO configuration (rate, cap, TO, categories, game providers)
- Message Template (inbox) content + locales
- SMS template (if applicable)
- Dialog Popup (if applicable)

All requested brands and regions must be checked. Do not ask for a reminder — this is always expected.
