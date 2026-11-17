# Google account and X sign-in

The site uses Supabase `linkIdentity({ provider: 'x' })` from the signed-in Google account.
Enable manual identity linking in Supabase Auth before publishing the site feature. Ordinary sign-in is not an account merge.
Both the start and callback verify the destination user. An X identity belonging to another user is refused without changing assets.
Unlinking X requires a second confirmation and a verified Google identity left on the account.

## Existing creator accounts

The operator tool is `scripts/creator-account-transfer.mjs`. Its database migration is
`supabase/migrations/20261117074343_creator_account_transfer.sql`.
This is a bounded transfer for a secondary account containing only creator records. It refuses other holdings, including game economies,
mail, payments, worlds and generation hosts. It is not a general merger for two active game accounts.

- Verify ownership of both accounts before preparing a transfer. Emails alone are not proof.
- Keep the destination Google account ID. Preserve all fighters, submission IDs, manifests, profiles, generation jobs and usage records.
- Sum existing token grants and usage; do not grant another signup reward. The source grant becomes zero and its creator access is disabled.
- Keep the larger fighter limit. Refuse when the combined live fighters exceed that limit; do not discard fighters or silently raise the limit.
- Preserve both account-agent histories, adding missing agent cards to the destination.
- Copy private assets to destination paths and compare SHA-256 bytes. Never overwrite a differing object or remove originals.
- Keep a private database snapshot in the transfer ledger. Repeated transfers, stale plans and unknown holdings fail closed.
- Do not delete either Auth user or edit `auth.identities` through SQL.

Run with an operator's `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. The local token-file fallback is the normal operator token store.
The plan contains private account records: save it outside Git, never paste it into a public issue or commit it.

```sh
node scripts/creator-account-transfer.mjs plan SOURCE_UUID TARGET_UUID /private/transfer-plan.json
node scripts/creator-account-transfer.mjs apply /private/transfer-plan.json
```

The tool requires the migration to have been applied through the normal database release process. Only the database operator can execute
the private functions; anonymous, authenticated and service roles cannot call them. Copy failures leave original assets and ownership intact.
If copying succeeds but the snapshot is stale, keep the copies, obtain a new plan and review it. Never rerun with a guessed new snapshot.

After the asset transaction, use the source account's connection dialog to unlink X. Google remains on that source account as a recovery route.
Then sign in to the destination Google account and link X through OAuth. A failure here does not undo or duplicate the asset transaction:
retry the OAuth step. Verify that Google and X now report the destination ID and the same roster/balance. Verify previews and downloads too.
Do not assume a successful DB transaction proves OAuth linking or file delivery.

## Verification

`node --test test/creator-account-transfer.test.mjs` uses an isolated migrated PGlite database. It covers immutable submissions, token conservation,
slot collision avoidance, absent copies, stale plans, unknown tables, duplicate execution and privilege denial. Storage copying requires a live
byte comparison by the operator CLI. Auth linking is tested in the game repository and requires a separate OAuth browser check after deployment.

## Decision record

2026-11-17: user chose to preserve both existing token balances and keep the larger fighter limit. This is an operator-reviewed transfer;
ordinary login linking never combines signup bonuses or transfers assets automatically.
