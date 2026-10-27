# Security

Report suspected vulnerabilities through GitHub's
[private vulnerability reporting](https://github.com/PKehnel/eselsohr/security/advisories/new).
Use that channel for sensitive details rather than a public issue.

This repository's issues, Actions logs and retained artifacts are public.
Automated issues contain check summaries and run links only. Never include
keys, real note content or member details in issues, logs or artifacts.

## Access and credentials

Firestore rules and active memberships enforce note access. Hiding signup or
keeping a web API key out of this source repository is not authorization.
`VITE_*` values are public in built JavaScript. Admin/CLI credentials belong
outside the source tree and never in Vite configuration or routine CI secrets.
See [Setup](docs/SETUP.md).

## Dependency monitoring

The Dependency audit workflow scans the full locked npm graph, including
development and transitive packages, every day at 07:23 UTC. It also runs on
dependency/scanner changes and can be started manually. It fails on high or
critical findings and on failed or incomplete scans. Every reported severity
opens or updates one public dependency-security issue; scan failures also open
it. A clean scan closes it, and later findings reopen the same issue. Maintainer
text outside the marked bot section and issue comments are preserved. JSON
reports are retained as workflow artifacts for 30 days. Dependabot proposes npm and Actions updates
on weekdays; its schedule does not replace the seven-day audit. Nothing merges
or deploys automatically.

Run the same check locally with `npm run audit:dependencies`. Low/moderate/info
findings remain visible in the report. PKehnel owns triage: for each finding
record the advisory, affected path, exposure, decision, follow-up date and
verification in a dependency PR or issue. Fix high/critical findings before
merging or publishing. A scan error needs a successful rerun, never a waiver
as if it were a clean result. There are no standing advisory exceptions.

Free Dependabot alerts appear in the repository's Security tab. No email action
or email service is configured. Personal notification preferences still govern
GitHub's own Dependabot, Actions and issue emails; disable email/digests there
if unwanted. The repository is public on GitHub Free. `main` requires a pull
request, an up-to-date branch, passing `app` and `secrets` checks from GitHub
Actions, and resolved review conversations. These rules apply to administrators;
force-pushes and branch deletion are blocked. No second reviewer's approval is
required, so the sole maintainer can merge a passing pull request.

Only trusted default-branch runs can write issues. Audit and scanner jobs retain
read-only permissions; separate reporting jobs receive only contents-read and
issues-write permissions. Pull-request jobs cannot write issues. Reporting uses
the built-in expiring GitHub token, with no stored account token or third-party
notification service. Repeated runs update one bot-owned issue per check;
older runs cannot overwrite a newer result.

Use the Dependency audit workflow's manual `exercise_issue` input to verify a
clearly marked synthetic issue's create/update/close/reopen lifecycle. It finishes
closed and never simulates a real vulnerability. Verify the first scheduled run
separately; successful manual runs do not establish hosted scheduling.

The CI workflow also scans the current source files with pinned Gitleaks 8.30.1.
Scanner failures open or update a separate public issue containing only a run
link and review instructions; a passing scan closes it. Detected values never
enter that issue. The Gitleaks job is a required pull-request check. GitHub's
native secret scanning and push protection are also enabled; push protection
blocks supported detected secrets before they enter the repository. These
checks do not detect every secret.
`npm run scan:secrets` downloads and checksums the official Linux x64 binary.
Other platforms can install that version and run `gitleaks dir --redact .`.
Scan imported Git history separately before adding it; the initial publication
should start with fresh app-only history.

## Dependency overrides

The lockfile retains scoped compatibility/security overrides: Firebase Firestore's
gRPC uses 1.14.6; Firebase CLI's Pub/Sub OpenTelemetry core uses 2.8.0; its gaxios
6.x branch uses uuid 11.1.1. Review consumer compatibility and remove overrides
when upstream resolves the affected versions. A lockfile audit is evidence for
the graph at scan time, not a claim of complete application security.
