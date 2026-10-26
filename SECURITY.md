# Security

Report a suspected vulnerability privately through this repository's GitHub
Security tab once private vulnerability reporting is enabled. Do not put keys,
real note content, member details or exploit instructions for a live instance
in a public issue. If private reporting is unavailable, wait for a private
channel from the maintainer rather than posting sensitive details publicly.

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
critical findings and on failed or incomplete scans. JSON reports are retained
as workflow artifacts for 30 days. Dependabot proposes npm and Actions updates
on weekdays; its schedule does not replace the seven-day audit. Nothing merges
or deploys automatically.

Run the same check locally with `npm run audit:dependencies`. Low/moderate/info
findings remain visible in the report. PKehnel owns triage: for each finding
record the advisory, affected path, exposure, decision, follow-up date and
verification in a dependency PR or issue. Fix high/critical findings before
merging or publishing. A scan error needs a successful rerun, never a waiver
as if it were a clean result. There are no standing advisory exceptions.

On repository setup, enable Actions failure notifications and private vulnerability
reporting, choose the workflows as required PR checks, and review a manual audit
and its report. Verify the first scheduled run and delivery of a failure notification
before claiming monitoring is active. Scheduled jobs run from the default branch;
GitHub can delay schedules or disable them after inactivity in a public repository.
Local checks cannot prove hosted scheduling or notification delivery.

The CI workflow also scans the current source files with pinned Gitleaks 8.30.1.
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
