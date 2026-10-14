# LinkedIn Page connection regression

Base: `v1.0.0-mt14`. Branch: `fix/linkedin-page-reconnect`.

The OAuth callback creates the pending integration using the organization stored
in Redis under the OAuth state. Previously, page selection switched to the
session-authenticated endpoint whenever any Postiz auth cookie was present. A
browser logged into another organization therefore received `404 Integration not
found` on Save. Production ingress recorded three 404 responses for the affected
Save requests after a successful 201 callback.

The callback now uses the existing state-backed public save endpoint regardless
of the browser session. This endpoint resolves the organization from Redis and
the service checks that the integration belongs to that organization. The
browser does not choose an organization ID or receive stored provider tokens.

Save failures now appear alongside the selection and can be retried. Network
failures release the Save button. Return URLs retain their existing query
parameters instead of appending a second question mark.

The persistence review also found that selecting the same integration marked its
posts deleted before restoring the integration. The duplicate cleanup now runs
only when the existing integration has a different ID, preserving posts on a
same-page reconnect.

## Validation

```sh
pnpm exec jest --config jest.social-connect.config.cjs --runInBand
pnpm exec tsc --project apps/frontend/tsconfig.json --noEmit --incremental false
```

- 10 regression tests pass, covering logged-in/logged-out callbacks, Save errors,
  retry, network errors, redirect parameters, single-step callbacks, and page
  persistence.
- Three selected regression cases fail on the original source and pass with the
  correction (session identity, malformed redirect, same-page post preservation).
- Frontend TypeScript check passes after local Prisma client generation.
- Production webpack compilation and its TypeScript phase succeed. The complete
  Next.js build fails later while collecting `/p/[id]` page data because bundled
  jsdom cannot find `browser/default-stylesheet.css`. That preview route and
  dependency are outside this patch; the full build is not validated.
- No production mutations, database migration, commit, push, or deployment.

## Release checks and recovery

Build an immutable Postiz image from the reviewed patch. Deployment requires user
approval. Verify through Plumeza with a browser already logged into a different
Postiz organization: select a LinkedIn Page, Save, confirm the branded return and
the channel imported under the intended customer. Also verify reconnecting an
existing page retains its integration ID and publication history. Use a fresh
OAuth flow if its state has expired.

Rollback is the previous immutable Postiz image; there are no schema changes.
