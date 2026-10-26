# Testing

Use Node 24 LTS (24.15+), Java 21+ and Google Chrome; see [Setup](SETUP.md).
Install with `npm ci`. Set `JAVA_HOME` if Java is not on PATH. Tests do not
require a Firebase account, CLI login, real notes or a production `.env.local`.
First-time emulator downloads and browser installation need network access.

| Change | Command |
| --- | --- |
| Queue, drafts, cache, outline or tooling guards | `npm test` |
| Membership, sharing predicates, rules or schema | `npm run test:rules` |
| Saving, creation, offline, sharing, tabs or account lifecycle | `npm run test:acceptance` |
| Tabs, sharing, typing or focus/Undo | `npm run test:tabs`, `test:sharing`, `test:typing` or `test:guidelines` |
| Layout, keyboard, menus or motion | `npm run test:ui` |
| Detailed donkey drawing/stride/toss | `npm run test:artwork` |
| Build, Hosting headers, public shell or worker | `npm run test:release -- --project eselsohr-example --mode delivery` |
| Exact files after an authorized deployment | `npm run test:release -- --live --project YOUR_PROJECT_ID` |
| Dependency graph | `npm run audit:dependencies` |
| Source secret scan | `npm run scan:secrets` |

The acceptance command already includes tabs, sharing, typing and guidelines.
Do not run them again without a reason. Related browser suites can share service
startup: `node tools/test.mjs acceptance ui artwork`. Use `--grep`,
`--repeat-each 2`, `--trace` or `--profile` to investigate a focused browser case.
Profile reports can be read with `node tools/profile-report.mjs REPORT.ndjson`.
Screenshots are opt-in with `--screenshots`, written to ignored `test-artifacts/`.
Inspect images before making a visual claim; do not publish unreviewed traces.

Rules checks issue actual Firebase client requests against synthetic Auth and
Firestore emulators. They cover non-members, private/selected/Everyone access,
creator-only sharing, both note namespaces and existing-token deactivation.
Browser cases use fresh synthetic accounts, records and contexts per case;
Saved assertions wait for real server acknowledgement. Tests stop their own
Vite/emulator processes and remove fixture records/users, including partial setup.
After forced termination, inspect owned processes before the next run.

Stop manual services first; the runner requires free ports 5173 (Vite), 8080
(Firestore), 9099 (Auth), or 5000 (local delivery). Emulator service/hub ports
also need to be free. It never stops another process to obtain a port.

## Delivery and upgrades

`.env.delivery` is an inert production-shaped configuration, selected explicitly
by `--mode delivery`. It has no usable key and needs no actual Firebase project.
The local release check builds/typechecks, serves `dist/` through the Hosting
emulator, checks exact bytes/headers and every reviewed raster hash, verifies
the stable manifest and complete public-only shell cache, and reopens offline.
It exercises upgrades from older cached workers with an editing page open,
preserving Auth/drafts and testing the bounded navigation fallback.

Live checks require an explicit project matching your production configuration
and existing `dist/`. They read the default project's web.app origin without
rebuilding. Browser Firebase requests in delivery checks are intercepted in
both modes: they prove shell delivery and permitted CSP connections, not live
authentication, token refresh, streaming or sharing. Behavior tests instead use
real local Auth/Firestore emulators. Demo/emulator configuration cannot build
as a production release; deployment/migration reject it before using credentials.

## Limits

Emulators do not establish cloud IAM, billing, quota behavior, index deployment
or a production backup/restore. This package omits operator recovery tooling.
Desktop Chrome does not prove Android keyboard/touch, TalkBack, two physical
phones, iOS, installed WebAPK/icon updates or a full browser-process restart.
Offline reopening retains browser storage in the test context.

Timing can vary during cold starts and acknowledgement-heavy journeys. A past
run has stalled beyond the existing 20-second server budget without a confirmed
cause. Keep failed evidence, investigate a focused reproduction and report a
retry honestly; do not increase deadlines or remove checks just to obtain green.

GitHub workflows use only synthetic configuration, with read-only repository
permissions and no production credentials or deployments. Local passing commands
do not establish hosted Actions scheduling or notification delivery.
