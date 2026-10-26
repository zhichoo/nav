# Security Notes

- Never commit real API keys, credential-bearing URLs, `.env`, `.dev.vars`, cache files or deployment tokens. Example files contain placeholders only.
- Shared translation credentials belong in the Node backend environment or Cloudflare Worker Secrets. Do not use `VITE_*` variables for credentials: those are public browser code.
- Personal translation credentials are intentionally stored as plaintext in the user's own browser localStorage, per the product's no-login design. Same-origin scripts, browser extensions and anyone with access to that profile may read them. Use revocable, low-budget keys on trusted devices. Clearing settings removes the stored configuration.
- Personal provider requests go directly from the browser and require CORS. This project does not provide a public translation relay or accept personal keys on its backend.
- The cloud backend only fetches the repository-controlled source catalog. Public readers cannot specify fetch targets, force synchronization or trigger paid site translation calls.
- Translation title limits are not currency limits. Set provider-side spending limits and monitor Cloudflare usage before opening a service to many readers.
- Rotate credentials that have previously been pasted into chat or shared elsewhere before production use. A clean repository does not undo a previous credential disclosure.
- Keep production dependencies current. Wrangler's Miniflare dependency currently has an Undici override to a patched 7.30.1+ version; recheck this override when upgrading tooling.

## Local Release Gate

`npm run release:check` checks non-ignored Git candidates, tracked working files and index blobs. It rejects private/generated paths, symlinks and detected credentials without printing matching values. `npm run release:check -- --history --dist --worker` also checks local Git history and existing build outputs; run `npm run cf:check` first to generate both outputs. The standard check/build commands include the applicable gates, so the existing CI runs them too.

Detection uses common credential patterns plus sensitive values from local root `.env*` / `.dev.vars*` files. It is a best-effort safety check, not a guarantee against arbitrary, encoded or previously disclosed secrets. Ignored files remain local; force-adding them makes the gate reject them. Frontend assets use an explicit allowlist; private snapshots, docs, tests, logs and caches do not belong in `dist`. Worker dry-run output stays in ignored `.wrangler/`.
