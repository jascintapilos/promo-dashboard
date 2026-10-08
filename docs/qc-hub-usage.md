# QC Hub Usage

## Sign in

Open the hub URL, click Sign in with Google, and use your work Google account. Only allow-listed emails get in. If you are refused, ask the admin to add you.

## Run a code

Pick the brand from the dropdown. Only enabled brands are selectable; others show "coming soon". Paste one or more promo codes, then click Run. A result card appears per code.

## The three states

PASS means the hub fetched the promo live and it matches what was requested. Nothing to do.

FAIL means the live promo differs from what was requested. Open the findings, fix the promo in the back office, then run it again.

MANUAL means the hub could not verify automatically because the back office was unreachable, or this brand is not on the automated path. Check the promo in the back office yourself.

## What "manual" means

The hub did not confirm PASS or FAIL for you. It is asking a human to look. It is NOT a failure.

## When to use Manual Pass

Use Manual Pass only after you have opened the back office and confirmed the promo is correct. On a MANUAL result, click "Manual Pass Override", enter a reason with 10+ characters that says how you checked, and add evidence such as a BO link or screenshot. It is recorded under your name and kept separate from an automated PASS. You cannot Manual-Pass a FAIL; fix the promo instead.

If a brand you need is missing, it may not be enabled yet - ask the admin to turn it on in data/qc-dashboard-brands.json.
