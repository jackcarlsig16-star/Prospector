# account-card-button-cleanup-v1

Goal: Fix three action buttons on the account card — one genuinely redundant, one misleadingly named, one that can't be removed without losing real capability.

## 1. Remove "⬡ SF" / "⬡ Salesforce" button

Confirmed redundant — the adjacent ✏ pencil icon opens the identical inline edit form for sfdc/web/linkedin. Remove the "⬡ SF" button from `LinksAndOutbound.js`'s render entirely. No replacement needed; the pencil remains as the sole edit entry point for these fields.

## 2. Rename "⎘ SFDC" — do not remove

This button is real, working functionality (fetches sent emails, generates an LLM-written Salesforce update note, copies to clipboard) mislabeled with a name that reads like a dead sync/link button. Rename to something that describes the actual action — e.g. "Copy SFDC Note" or "Generate Update" (coder's call on exact wording, should be short enough to fit the existing button style). No behavior change — same click handler, same LLM call, same clipboard copy. This is a labeling fix only.

## 3. Client ID — do not remove yet. Give it a real edit path first

Confirmed this button is the only UI surface anywhere on the card to view or edit `acc.clientIds` — removing it as originally requested would make the field invisible/uneditable from the UI while the data stays orphaned in Supabase. Before any removal:

- Fold `clientIds` into the same inline-edit form the pencil icon already opens for sfdc/web/linkedin (add it as one more field in that existing form, not a new UI surface).
- Once `clientIds` is editable there, the dedicated "🪪 Client ID" button becomes redundant the same way "⬡ SF" was, and can be removed in a follow-up pass.
- This SPEC does not remove the Client ID button yet — only adds the field to the pencil's edit form. Removal is a separate, later step once confirmed working.

## Explicitly out of scope

`syncSfdc` and all backend SFDC sync logic (confirmed entirely separate code path, untouched either way), `SF_BASE_AC` placeholder URL issue (noted but not part of this SPEC), any other button on the card.

## Verify

On a real account card — confirm "⬡ SF" is gone and the pencil still opens/saves sfdc/web/linkedin correctly; confirm the renamed SFDC-note button still generates and copies correctly; confirm the pencil's edit form now includes clientIds and saves it correctly via onUpdate.

## Ship

Commit + push, confirm live deploy via bundle-hash check same as prior fixes.
