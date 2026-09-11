# Terminal blog and MinIO implementation plan

**Goal:** Deliver an API-backed blog with MinIO storage and terminal-contained reading, editing, account, search and display workflows.

**Architecture:** Preserve the existing WebFlux/R2DBC blog and immutable publishing model. Introduce explicit shell, inline program and Vim buffer modes. Reuse the authenticated revision API for administrator writes; label reader edits as browser-local copies. MinIO remains private behind the existing media APIs.

**Constraints:** Never expose credentials in history or Git. Do not publish drafts on editor save. Preserve Chinese IME composition, native form editing and CSRF/session checks. Proxy recovery restored SSH access to `qa-user@qa-host`. Validate in the separate `hadesd-terminal-qa` Compose project, preserving production.

## Work packages

- [x] Terminal core and keyboard routing: `packages/terminal-core`, `apps/web/app/shell/{Terminal,ScreenPager,Shell}`, new Vim buffer. Verify open, normal/insert/command modes, paging after typing, completion, cancellation, dirty guards, `:w`, `:wq`, `:q`, `:q!` and storage failures.
- [x] Inline programs: `apps/web/app/community`, `shell/{Settings,Palette,Modal}`. Keep account, files, comments, search and settings within the screen, with keyboard exits and no floating dialogs or notifications.
- [x] Backend editor adapter: `shell/blogEditor.ts`. Fetch latest private revision on edit intent, preserve all metadata, send optimistic version, advance it only on successful save. Tests cover metadata/version, conflict and authentication.
- [x] MinIO: `backend`, `infra/compose`, storage migration/backup tooling and `docs/minio.md`. Private bucket, readiness, robust S3 missing-object behavior, checksum-verified additive migration and accurate backup coverage. Production backup now exports S3 objects; complete backup verified using QA paths.
- [x] Integration: run TypeScript/unit/backend checks and production build; exercise desktop/mobile terminal interactions in Chromium-based Edge; update usage docs with actual behavior and clearly state any remote or Docker validation limits. Results are recorded in `docs/terminal-minio-validation.md`.

## Acceptance

The terminal retains a visible mode indicator and does not steal keys from another form. Published files open inside its Vim buffer. Administrator `:wq` creates a private revision and returns to shell; failed writes keep text open. Account, search and display workflows have no public modal overlays. Existing media URL permissions remain unchanged when objects move to MinIO.
