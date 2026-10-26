# Eselsohr

A small shared notebook with text notes, nested checklists and an offline app
shell. New notes are private; their creator can share with selected members or
everyone in the notebook. Built with TypeScript, Vite and Firebase.

## Try it locally

Use Node 24 LTS (24.15+), Java 21+ and desktop Google Chrome. Set `JAVA_HOME`
if Java is not on PATH. No Firebase account or production credentials are needed.

```sh
npm ci
npx playwright install chrome
npm run emulators
```

In another terminal, run `npm run seed:emulator`. Choose a disposable password
when prompted. Then run `npm run dev:emulator` and open
<http://127.0.0.1:5173>. Sign in as `alex@example.test`, `sam@example.test` or
`jo@example.test` with that password. `visitor@example.test` has no membership.
All emulator data is synthetic and disappears when the emulators stop.

## Use your own Firebase project

Follow [Setup](docs/SETUP.md) for Authentication, Firestore, memberships and
explicitly targeted Hosting releases. This source repository grants no access
to an existing installation. Do not use real notes in tests or examples.

```sh
npm test
npm run test:rules
npm run test:acceptance
npm run test:release -- --project eselsohr-example --mode delivery
```

The last command builds with an inert configuration and checks local Hosting,
offline delivery and upgrades from older cached workers. It deploys nothing.
See [Testing](docs/TESTING.md) for focused checks and limitations,
[Architecture](docs/ARCHITECTURE.md) for the data model, and
[Security](SECURITY.md) for dependency monitoring and reporting.

## Limits

Notes have no end-to-end encryption; Firebase project administrators can read
them. Sessions, cached notes and unsent drafts persist on the device. Use a
trusted device with a screen lock. Revoking access takes effect on reconnection
and cannot retract copied data. Edits to the same field use the last accepted
write; there is no conflict history. Saved means server acknowledgement.

One notebook, administrator-created accounts, text and checklists are supported.
There are no attachments, public invitations, self-service password recovery,
in-app exports or permanent note deletion. This source package does not include
the original installation's operator backup/scheduling tools. Arrange and test
your own database recovery before entrusting important data to a new instance.

## Reuse

Copyright 2026 PKehnel. Software is **source available for noncommercial use**
under [PolyForm Noncommercial 1.0.0](LICENSE). It is not an OSI open-source license.
The license expressly permits use by certain charitable, educational, research,
public-service and government organizations; read its exact terms.

Eligible documentation and shipped raster donkey artwork use
[CC BY-NC 4.0](LICENSES/CC-BY-NC-4.0.txt). Source SVG drawing and animation code
use the software license. See [licensing scope and asset origins](docs/LICENSING.md)
and [third-party notices](THIRD_PARTY_NOTICES.md). The private reference drawing
and unpublished artwork packs are not included or offered under these terms.

Changes are welcome under the applicable existing terms; read
[Contributing](CONTRIBUTING.md).
