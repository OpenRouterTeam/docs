---
name: order-form-filling
description: Fill out OpenRouter enterprise order form PDFs (Monthly Billing or PayGo/On-Platform) given customer info and deal terms
user-invocable: true
---

# Filling Out OpenRouter Order Forms

## Trigger

You are triggered via Slack mention `@Devin !order-form`. The AE will provide a blank PDF template, customer information, and deal terms in the thread. Produce a completed, clean PDF with all information filled in.

**Important:** Only process requests where you are explicitly triggered with `!order-form`.

## Finance Guidelines

These rules MUST be followed when filling out order forms:

### Template Selection

There are two templates. AEs must confirm which payment model the customer wants:

- **Monthly Billing** — Customer is invoiced monthly in arrears. Has "Upfront Payment", "Net Payment Terms", and "PO #" fields. Special Terms include a termination clause (credit balance deducted from final invoice).
- **PayGo / On-Platform** — Customer pays via credit card on-platform or bulk credit purchases upfront. Has "Bulk Purchase" instead of "Upfront Payment". No "Net Payment Terms" or "PO #" rows. Special Terms include a "Credits" clause (non-refundable, non-expiring while account active).

A customer can have an annual commit (Minimum Spend + Yearly True-Up) on EITHER template. If finance says "keep them on paygo" or "revise to paygo order form", use the PayGo template — the commit still applies.

### Upfront Payment (Monthly Billing) / Bulk Purchase (PayGo)
- **Monthly Billing (Upfront Payment)**: Equal to *1/12th of the 1st year's minimum spend*. Example: If minimum spend is $24,000/year, upfront payment = $2,000.
- **PayGo (Bulk Purchase)**: Only include this row if the customer is doing a bulk credit purchase upfront. Must be at least *1/12 of minimum commit*.
- **PayGo (Standard on-platform)**: *Remove the Bulk Purchase row entirely* and remove "Bulk purchase upfront" from Payment Model text. Payment Model should only say "On-Platform: Credit purchases through OpenRouter portal".

### Platform Fee
- Needs *finance approval* to change from standard terms.

### BYOK Fee
- Standard: 5 million free requests/month, $250 per additional 5 million API calls.
- Needs *finance approval* to change.

### Payment Method
- **Monthly Billing**: Preference is *ACH*.
- **PayGo / On-Platform**: If doing credit purchases through the OpenRouter portal, this will be *Credit Card*. If doing bulk purchase, preference is *ACH*.
- Must select one (ACH, Wire, or Credit Card) so finance knows how to bill them.
- Needs *finance approval* to change.

### Net Payment Terms
- Standard is Net 7.
- *Only applies to Monthly Billing*. PayGo/On-Platform template does not have this field.

### Minimum Spend
- *Remove for one-off bulk orders*. Keep for committed enterprise customers.

### Yearly True-Up
- Finance stays strict on this term. Not something that gets changed often given risk exposure.
- Needs *finance approval* to change.
- *Remove for one-off bulk orders for non-Enterprise customers* (along with MSA language).

### Option 1 vs Option 2 (Special Terms)
- *If the customer does NOT redline the MSA*: Keep Option 1, delete Option 2. The customer agrees to the terms of the online MSA (https://openrouter.ai/terms-of-service-enterprise) by signing the order form. No separate MSA needed.
- *If the customer DOES redline the MSA*: Keep Option 2, delete Option 1. Send the updated/redlined MSA as an additional document for signature.
- Always delete the unused option entirely — remove the "OPTION X:" prefix from the kept option so it reads as plain text. Renumber remaining items sequentially.

### Special Terms for One-Off Bulk Orders (Non-Enterprise)
- *Remove MSA language* (Option 1/2) and *Yearly True-Up* for one-off bulk orders for non-Enterprise customers.
- Keep only the *Credits* clause.

### [CUSTOMER] in Signature Block
- Always replace with the actual customer legal name (e.g., "INTERACTIVEAI LIMITED").

## Approach: Build from Scratch with pymupdf

Do NOT try to edit the original PDF in-place (redacting/re-inserting text). This leads to artifacts like grey backgrounds instead of removed highlights, dot characters from zero-width spaces, and misaligned text. Instead, *rebuild the entire PDF from scratch* using `pymupdf` (`fitz`). Analyze the template PDF first using `page.get_text("dict")` to extract exact layout, colors, fonts, and positions.

### Formatting Rules

- All text: Helvetica 10pt black. Bold labels use Helvetica Bold.
- Header row text is white on purple/blue background.
- No highlights, no red text, no brackets around values.
- Grid lines use the same purple/blue color as headers.
- Use plain ASCII only — no Unicode (en-dash, curly quotes, curly apostrophe). These render as dots.
- Do not use zero-width spaces — they render as visible dots.

### Verify Output

Always open the generated PDF in the browser and visually verify:
- All customer info is filled in correctly
- No highlights or colored text remain
- Table grid lines align properly
- Special terms flow naturally with no gaps
- Signature block has correct company name
- Both pages look clean

## Deal Desk Approval

AEs may also ask you to draft a Deal Desk Approval message. This is a short Slack-friendly summary with:
- Company name and brief summary (2-3 sentences max)
- Proposed commit amount and platform fee percentage
- Current spend data
- Any relevant notes about growth or timing
- Link to the Order Form (OF)

Format it as a Slack message (not a file) using Slack-compatible formatting (*bold*, not markdown headers).
