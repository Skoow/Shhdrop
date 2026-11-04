# Plan 1 — décisions prises pendant l'exécution

Chaque ligne : ce qui a été décidé — pourquoi — ce que ça coûte si c'est faux. Ordre chronologique.

- Ruling: Go mirrors TS sizing as share.SegmentCount(bucket)/share.SegmentSize(bucket,n) + share.Buckets, same test values as T4 — spec §7.3 is authority — cost if wrong: small refactor.
- Ruling: GET /api/captcha returns {challenge, shown_at_token} where shown_at_token = token.Signer.Issue('c', "captcha", 0, now+2min) carrying issue time; T8 verifies and derives shownAt — keeps state out of client — cost if wrong: small API change before Plan 2.
- Ruling: `shhdrop serve` prints exactly one stdout line `SHH_LISTENING <host:port>` after binding — needed by e2e — cost: none.
- Ruling: T10 network-cut test simulates failure via the wrapped fetch (first N segment PUTs throw), not a server restart; spec §7.7 says restart invalidates transfers — cost if wrong: resume-after-restart untested (by design impossible).
- Ruling: work on branch plan-1-coeur (user said "fais tout"; skill forbids main without consent), push branch after each task, merge to main at finish — cost: none.
- Note: "signed commits" in CLAUDE.md means authored with noreply address (no GPG key available) — Ruling: no cryptographic signing — no key exists in this env — cost: owner may want GPG/SSH signing later.
- Ruling: HKDF/HMAC info strings all prefixed "shhdrop/v1/…" (plan) rather than bare "contenu"/"preuve"/"engagement" (spec §7.1) — stronger domain separation; spec to be aligned — cost if wrong: none (format not yet deployed).
- Ruling: client caps KDF params at ops<=10, mem<=268435456 (256 MiB) and rejects above ("paramètres KDF invalides") — malicious server could otherwise freeze/crash the browser (spec §7.1 only sets a floor) — cost if wrong: a future param bump beyond caps needs a client update.
- Ruling: commits = author Skoow noreply via --author, committer = global signed Claude identity (stop hook: unverified commits) — local user.* override removed — cost: none.
- Ruling: the 4 unverified commits already pushed (327db93, b315ae4, 13b7105, 0d98ddd) are NOT rewritten (force-push denied by safety classifier); at finish, merge to main via squash commit (signed) — cost: branch history shows them unverified.
- Ruling: Task 3 blocklist kept although only ~10 entries ≥12 chars (spec §4 requires it; cheap) — cost: negligible extra protection.
- Ruling: SecLists file has 10001 lines; pinned 10001; test uses "unbelievable" instead of "password1234" (not in list) — cost: none.
- Ruling: GCM nonce = chunk index ⇒ uniqueness relies on a fresh K_contenu per seal; Task 10 createShare MUST generate fresh kLien + salt per call and retries must resend already-sealed segments, never re-seal (carry to Task 10 dispatch + test) — cost if wrong: catastrophic nonce reuse.
- Ruling: Task 4 extras approved (taille_invalide, texte_invalide, empty-manifest reject, reserved header bytes zero) — stricter parsing, spec-consistent.
- Ruling: "10 000 caractères" = Unicode code points — cost: none.
- Ruling: add WeakSet<CryptoKey> guard in seal (refuse a second seal with the same kContenu) during Task 10 — defense in depth vs nonce reuse — cost: none.
- Ruling: adopt Go 1.26 (required by modernc.org/sqlite v1.61.1; newest toolchain = latest security fixes) instead of pinning an older sqlite; CI must use `go-version-file: server/go.mod` instead of "1.24" — cost if wrong: contributors need Go 1.26.
- Ruling: Task 6 extras approved (in-memory Create lock vs StorageMax race; RW lock PutSegment/Finalize; CAS on segments_mask) — prevent races; single-process by design — cost: none.
- Ruling: Meta/Unlock on draining → not_found (uniform error) — UI (Plan 2) shows "plus d'ouverture disponible / lien expiré" generic message — cost: none.
- Ruling: Task 7 deviations approved: limits.Key → (*Limiter).Key + limits.Prefixes; captcha binds to /64 via its own HMAC subkey (survives midnight rotation); altcha-lib-go used for creation only, own strict verification (salt regex vs digit-shift extension attack, hmac.Equal, injected clock); difficulty level embedded in salt — all strengthen security — cost: none.
- Ruling: Task 8 adds config SHH_BEHIND_PROXY (default "0"); when "1", a loopback request without a valid X-Shh-Client-IP gets 500 (fail closed, avoids site-wide single bucket); handler refuses zero/absent shownAt — cost: one env var.
- Ruling: Task 8 deviations approved (api.New behindProxy param; token.CheckExp; 409 incomplete; 404 on 5th wrong pw; no-store everywhere).
- Ruling: daily byte quota counts useful capacity bucket*65536 (not ciphertext 48+bucket*65552) so 3 max-size shares fit 300 MiB — spec §4 intent — cost: ~0.02% more disk than quota.
- Ruling: validate request fields + frozen before consuming captcha/quota.
- Ruling: GET /healthz (loopback only → 200 "ok"); in-memory report counter deferred to Plan 3 (alerts).
- Ruling: behindProxy=true → non-loopback peer rejected (403/500, fail closed); ReadTimeout/WriteTimeout raised to 300 s (4 MiB segments on slow links).
- Ruling: Task 8 fix choices approved (ReadSegment(id,n,openN), share.Validate, Service.Frozen, healthz 404 when X-Shh-Client-IP present, abort on panic after headers).
- Ruling (Task 10): e2e starts a fresh server per test group (limits/captcha state in memory) so ≤10 creations per server; tests solve ALTCHA in node and honor the ≥3 s shown_at delay; no test-only bypass in the server — cost: slower e2e (~1 min).
- Ruling: memory scan skip must FAIL when env CI is set (blocking test must not silently weaken in CI) — fix in Task 10 loop.
- Ruling: 1 try + 5 retries (0.5→8 s) matches "réessayé 5 fois" — keep.
- Ruling: error mapping = network→"reseau", 429→LimitError, bad pw→BadPasswordError, all else→NotFoundError.
- Ruling: done() still called after a failed download (open already consumed at unlock; no recovery possible either way) — Plan 2 UI must warn "en cas d'échec, l'ouverture est perdue" — cost: content loss on network failure with maxOpens=1 (by design).
- Ruling: createShare maps 429 → LimitError; lien_invalide and mot_de_passe_requis stay local errors (user typing mistakes, no server info) — cost: none.
- Ruling (I1): admit honestly in spec that the filesystem keeps birth/change times the app cannot erase (visible only to someone reading the unlocked volume); apply WITHOUT ROWID, purge_at and upload_deadline rounded up to the quarter hour, keep Chtimes — cost: residual metadata for an attacker with live disk access (documented).
- Ruling: include cheap minors in the final fix wave: temp_store(MEMORY); chmod data dir 0700 + db files 0600 at start; parseLink accepts http only for localhost/127.0.0.1/::1; uploads with no segment received within 5 min are swept (anti empty-reservation DoS); fallocate when available (fallback Truncate); admin wipe creates frozen first; CI adds govulncheck + npm audit --omit=dev + `permissions: contents: read`.
- Ruling: altcha-lib-go v1.0.0 upgrade accepted (fixes a known vuln; our regex already blocked it) — cost: Plan 2 widget must match v1 salt format.

## Points mineurs reportés

- Task 1: minor (deferred): Makefile test-go lacks -race (CI has it)
- Task 1: minor (deferred): no test for unb64u non-canonical padding bits ("ab" must throw)
- Task 1: minor (deferred): @types/node "22" range not exact pin
- Task 1: minor (deferred): vite 6.0.3 / vitest 2.1.8 dev-only audit vulns — bump to patched versions (prod deps: 0 vulns)
- Task 1: minor (deferred): passWithNoTests duplicated in package.json and vitest.config.ts
- Task 2: minor (deferred): spec §7.1 info strings not prefixed — align spec doc with "shhdrop/v1/…"
- Task 2: minor (deferred): empty password not refused in kdf (UI must refuse; checkPassword in Task 3 covers custom pw)
- Task 2: minor (deferred): no test for zeroing on error path (not observable)
- Task 3: minor (deferred): duplicate é×11 assertion; weak generatePassphrase(6) length check; blocklist could be filtered to ≥12 code points (bundle size)
- Task 4: minor (deferred): "engagement invalide" not snake_case; plain not zeroed on manifest-validation failure; seal lacks runtime kind/name/mime checks; missing tests (extra chunk bucket 81, re-split segments); trop_gros test allocates 100 MiB
- Task 5: minor (deferred): store DSN "file:"+path not URL-escaped; Checkpoint busy column ignored (check in purge); no overflow test off=MaxInt64
- Task 6: minor (deferred): upload_deadline reveals creation time to the minute for ≤1 h during upload (could round to 15 min); spec §7.5/§9.1 still mention downloads_active (align to opens_issued+done_mask)
- Task 6: minor (deferred): Destroy counts wrong attempts in draining (link holder can kill an in-progress last download) — restrict counting to ready+not expired; Status ignores failed_attempts>=5; TestSweepRechecksFinalized fragile on quarter-hour clock; sweepOne holds uploadMu exclusively
- Task 7: minor (deferred): two concurrent Verify at level 0 both pass before RecordCreate (count in Verify); counter maps grow with distinct /64 until daily reset.
- Task 7: minor (deferred): AllowRequest memory lever via many /64 in a /48 (add per-/48 req limit or cap map); retryAfter for impossible byte sizes; captcha shownAt.IsZero not refused inside Verify
- Task 8: minor (deferred): forced shutdown doesn't wait for running handlers (WaitGroup); Destroy liveness lacks failed_attempts<5; spec §4 wording 100 Mio
- Task 9: minor (deferred): wipe with live server race (run freeze first inside wipe); Reconcile error aborts startup; no sweep at janitor start; test gaps (uploading row kept, WAL truncated after wipe)
- Task 10: minor (deferred): kPreuve zeroing not tested and kept until end of createShare (zero right after seal); scan drops rest of window on read failure; no spawn 'error' listener; destroyShare doc vs BadPasswordError mapping; confirm CI env not overridden
- Final: minor (deferred): M1 early sweep at 5 min may hit a very slow first segment (use upload_deadline−50 min); tightenPerms chmod on Docker volume root may EPERM; no migration to WITHOUT ROWID (delete test DBs); pin govulncheck version.

## Reporté aux Plans 2 et 3

- Carry to Plan 2: names/MIME from manifest are untrusted (sanitize names; allowlist for inline display).
- Carry to Task 8: Done(openN) trusts openN — HTTP download token must HMAC-bind openN (test forged openN rejected).
- Carry to Task 8: order = verify captcha (shownAt from verified 'c' token) → AllowCreate → Create → RecordCreate; captcha consumed even if creation fails (acceptable).
- Carry to Plan 2: pin npm altcha@2.3.0 or verify v3 compatibility with the SHA-256 challenge format.
- Carry to Plan 3: Caddy must SET (replace) X-Shh-Client-IP via header_up, never append.
- Carry to Task 9: janitor MUST be wired into serve (Sweep + Checkpoint every minute) + Reconcile at start.
- Carry to Plan 2: static server must not list dirs nor serve dotfiles; SPA fallback.
- Carry to Plan 2: front end fetches a fresh captcha for every create. Carry to Plan 3: do not route /healthz through Caddy; implement report counter.
- Carry to Plan 2: keep K_preuve after openShare so recipient can destroy during draining; UI warns that destroy with wrong password consumes an attempt; finalize not retried (UI message on failure).
- Deferred to Plan 2/3 per final triage: open() wipe/zero-copy (Plan 2 first), vite/vitest bump before any `vite dev` (Plan 2 first), Docker network for client IP (Plan 3), report counter (Plan 3), Dependabot + SHA-pinned actions (Plan 3), dead code ClientIP/Key.
