# Setup and deployment

## Local development

Install Node 24 LTS (24.15+), Java 21+ and Google Chrome. `npm ci` installs the
pinned tools. Use `npx playwright install chrome` if Chrome is absent; Linux
may also need its browser system dependencies. The test configuration uses
the `chrome` channel. Set `JAVA_HOME` to your JDK if needed; otherwise Java is
found on PATH. The first emulator launch downloads Google's emulator runtime.

Start `npm run emulators`, run `npm run seed:emulator` in a second terminal,
then `npm run dev:emulator`. The app is at <http://127.0.0.1:5173>. Choose a
disposable password at the seeder's hidden prompt, then sign in with
`alex@example.test`, `sam@example.test` or `jo@example.test`. The visitor account
has no membership. Re-running the seeder updates fixture passwords/membership
and preserves edited sample notes. Emulators have no persistence configured.

`.env.emulator` selects the isolated `demo-eselsohr` project. Backend endpoints
bind loopback: Firestore 8080, Auth 9099. The app refuses emulator mode outside
local development. Stop manual services before automated tests, which start and
stop their own services. Never use real notes or production credentials for tests.

## An independent Firebase installation

1. Create your own Firebase project and register a Web app. Create the default
   Firestore database in Native/Production mode in a suitable region. Do not
   run `firebase init` over these prepared files or open Test-mode rules.
2. Enable Email/Password Authentication. Configure enumeration protection,
   a minimum 12-character password policy and your Hosting authorized domains.
   The app has no signup/reset/verification UI. Direct client signup is still
   possible unless restricted separately; accounts without active membership
   cannot access notes. Review quotas and abuse controls for your use.
3. Copy `.env.example` to `.env.local` and fill the Web app's API key,
   authDomain, projectId and appId. Keep `VITE_USE_EMULATORS=false`. The project
   ID must match every explicitly targeted release/migration command.
4. Install/configure Firebase CLI access for this directory. Use
   `npx firebase login:add` and `npx firebase login:use YOUR_ADMIN_EMAIL`
   to preserve unrelated saved logins. Verify access before deploying. CLI
   authentication and Admin SDK Application Default Credentials are separate.
5. Run the local checks in [Testing](TESTING.md), then explicitly deploy the
   supplied rules/indexes to your project:

   ```sh
   npx firebase deploy --project YOUR_PROJECT_ID --only firestore:rules,firestore:indexes
   ```

6. Use Console administration to create approved email/password accounts.
   For each Auth UID, create `members/{UID}` with `displayName` (string, 1–60
   characters) and `active` (boolean, true). Do not put email, password or UID
   inventories in the repository. Users need no project administrator role.
   No `notebooks/home` parent document or schema-version metadata is required.
7. Verify membership and non-member denial with disposable data, then release
   from an interactive terminal:

   ```sh
   npm run release -- --project YOUR_PROJECT_ID
   ```

The release command checks the exact config/target, rejects demo/emulator
environments, asks for the target ID, rebuilds, preflights legacy sharing,
deploys rules/indexes, migrates missing legacy sharing metadata, checks query
readiness, and publishes Hosting. The migration asks for confirmation before
writes. An empty new project requires no metadata changes. Legacy notes missing
`audience` in the shared namespace become `everyone`; review that behavior before
releasing an older instance. Read-only preflight is available with
`node tools/migrate-sharing.mjs --project YOUR_PROJECT_ID --check`.

After a release, keep its exact `dist/` and verify it without rebuilding:

```sh
npm run test:release -- --live --project YOUR_PROJECT_ID
```

This reads the matching `https://YOUR_PROJECT_ID.web.app` files/headers and
intercepts browser Auth/Firestore calls. It does not prove real login/sharing
or receipt by an installed phone app. Preserve unsaved work in every open
window before closing/reopening for updates. Never clear browser storage to
hide an update or cache defect. Hosting rollback changes frontend files, not
rules or data; older broad-query builds may be incompatible with current rules.

## Configuration and credentials

Firebase Web API keys identify a project; they do not grant Admin access.
`VITE_*` values become public browser JavaScript. Keeping them in `.env.local`
separates installations but does not hide them from users. Restrict the browser
key to the Firebase APIs your app needs; use separate keys for unrelated paid
APIs, and never allow Gemini's Generative Language API on this public browser
key. Review HTTP referrer restrictions against sign-in/token-refresh behavior.
Firestore rules and active memberships protect data.
[Firebase API-key guidance](https://firebase.google.com/docs/projects/api-keys).

Keep CLI tokens, Application Default Credentials and service-account keys outside
this source tree. Never put them in `VITE_*`, browser assets or routine GitHub
Actions secrets. Console provisioning needs no downloaded service-account key.
The optional `npm run admin -- create-user|activate|deactivate|reset-password
--project YOUR_PROJECT_ID` tools use ADC and interactive target confirmation;
passwords are hidden prompts, never command arguments. Prefer Console if you do
not already have suitably scoped ADC.

## Recovery and operational limits

There is no end-to-end encryption, in-app export, conflict history or permanent
note deletion. Checklist Undo lasts 2.5 seconds and is not a backup. Configure
your own recovery process and prove restoration in an isolated environment,
including both note namespaces, rows below absent parent documents, UID/owner
mappings and stale offline writers. Old offline sessions can overwrite restored
content unless the recovery process gates them. This package excludes the
original installation's backup tools, local keys and schedules. It makes no
claim that a new installation has active backups or proven recovery. Review
Firebase's current pricing before enabling paid services.

Production memberships and rules remain the access boundary. Revocation cannot
retract cached/copied content from an offline device. Use trusted, locked devices.
