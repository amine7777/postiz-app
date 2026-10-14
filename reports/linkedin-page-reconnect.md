# Safe OAuth page connections

Target: `sype/postiz-app`, `main`. Branch: `fix/linkedin-page-reconnect`.

## Problem and behavior

The OAuth callback resolves the organization from its Redis state. Page selection
previously switched to the browser's authenticated Postiz organization whenever
an auth cookie existed. A different browser organization caused Save to return
404, while the selector hid the error. Save now retains the OAuth state identity,
shows errors with retry, and preserves existing branded return URL parameters.

The provider's first administered page is no longer used as an integration key
before selection. Each two-step connection gets an isolated
`pending:<provider>:<UUID>` identity. Finalization runs in a serializable
transaction: update the selected existing page (retaining its ID and post
relationships) or finalize the isolated draft as a new page. Only the draft is
retired, and publication rows are never modified. Unsafe old callbacks that
would transform a real page A into another page B are rejected with a reconnect
instruction. A same-page legacy reconnect remains supported.

Fresh token, refresh token, expiration, root identity and custom configuration
follow the selected page. Token propagation is scoped to its organization and
provider, and refresh workflows start on the final integration ID. Callback
responses contain selection metadata rather than stored credentials.

Drafts are excluded by default from public lists, quota counts, automation lists
and downgrade operations. The native configuration list opts in to incomplete
connections for resumption.

`isomorphic-dompurify` remains external to the frontend server bundle so jsdom
can resolve its filesystem stylesheet asset during prerendering. The test DOM
environment treats optional native canvas as absent; no production resolver is
modified.

## Verification

```sh
pnpm exec jest --config jest.social-connect.config.cjs --runInBand
pnpm exec tsc --project apps/backend/tsconfig.build.json --noEmit --incremental false
pnpm exec tsc --project apps/frontend/tsconfig.json --noEmit --incremental false
```

- 25 tests pass, including 11 against a disposable local PostgreSQL instance.
  Coverage includes A -> new/existing B, reconnect A, complete publication-row
  preservation, intertenant rejection, separate LinkedIn application credentials,
  token propagation, legacy safety, concurrency, transaction rollback and
  completed-channel lists before and after selection.
- The DB suite requires `POSTIZ_CONNECT_TEST_DATABASE_URL` pointing explicitly
  to `127.0.0.1/postiz_connect_test`; other hosts/databases are refused. Without
  this variable, the database suite is skipped. The CI workflow provides a
  disposable PostgreSQL 16 service and runs all suites.
- Backend production TypeScript check passes. The complete frontend production
  webpack build passes, including TypeScript, page collection and trace generation.
- Independent review cleared the historical publication-loss P1 and the pending
  channel/quota P2, with no remaining P0-P2 finding.
- No schema migration or production data/configuration mutation.

## Release and recovery

After merging, build an immutable Postiz image from the reviewed source.
Deployment still requires approval for the named production target. Verify from
Plumeza using a browser already signed into a different Postiz organization:
select a LinkedIn Page, Save, confirm the branded return and import under the
intended customer. Reconnect an existing page and verify its ID and publication
history. Abandon a callback and confirm it does not appear as a connected channel.
Start a fresh OAuth flow if the old state expires.

Rollback is the previous immutable Postiz image; no schema rollback is needed.
Draft rows may remain hidden in the database. No production repair or automatic
cleanup of older incomplete integrations is included.
