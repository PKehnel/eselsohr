# Licensing and artwork origins

Credit: **PKehnel**, Eselsohr, 2026.

| Material | Terms |
| --- | --- |
| App source, tests, tools, SVG drawing/animation code, build and workflow configuration | PolyForm Noncommercial 1.0.0, [LICENSE](../LICENSE) and required [NOTICE](../NOTICE) |
| Original prose documentation, README screenshots and shipped PNG/WebP donkey assets | CC BY-NC 4.0, [full text](../LICENSES/CC-BY-NC-4.0.txt) |
| License texts and third-party dependencies/notices | Their own terms; no relicensing claim |

Software can be used, changed and distributed for the purposes permitted by
PolyForm Noncommercial. Preserve its terms and the Required Notice when
redistributing. It expressly permits specified noncommercial organizations,
including charitable, educational, public research, public-service and government
institutions. It does not impose a blanket ban on organizational use.

For eligible documentation/artwork, credit “PKehnel — Eselsohr”, retain the
CC BY-NC 4.0 license link and identify changes. No commercial rights are offered
under these project terms. Rights not subject to copyright cannot be restricted
by a copyright license. This is source available for noncommercial use, not
OSI-approved open source. The two full license texts control over this summary.

## Shipped artwork

[ASSETS.json](ASSETS.json) records the exact reviewed runtime files and SHA-256
hashes. The release check verifies every raster asset against this inventory.

| Paths | Origin and processing |
| --- | --- |
| `public/icons/icon-192.png`, `icon-512.png` | Generated donkey portrait from the v1 pack (2026-10-14), mechanically resized for the PWA launcher |
| `public/themes/donkey-v1/corner-loaf.webp` | Generated v1 resting pose (2026-10-14), mechanically trimmed/encoded |
| `public/themes/donkey-v1/idle-blink.webp`, `completion-pounce.webp` | Generated v1 sprite sheets (2026-10-14), mechanically sliced/aligned/encoded |
| `public/themes/donkey-ui/online-sage.webp`, `offline.webp`, `bin.webp`, `people.webp` | Generated interface art (2026-10-15) using the v1 character as reference, mechanically trimmed/resized/encoded |
| `src/views/donkey-character.ts`, `donkey-run.ts` | App-specific articulated SVG geometry and animation code, using the established character as visual reference; software license |
| `docs/media/notebook.png`, `checklist.png` | Unedited captures of the running app in desktop Chrome at a 390 × 844 mobile viewport (2026-10-27), using synthetic local emulator data; documentation/artwork terms |
| `docs/media/architecture.svg` | AI-authored SVG diagram of the current app and its Firebase/device storage boundaries; software license |

The raster illustrations were generated with an AI image tool using the
maintainer's own private donkey drawing as the original character/style
reference. The maintainer confirmed ownership of that reference and selected
the derivatives for distribution. The private reference, embedded previews,
masters and pack archives are deliberately excluded. Their omission does not
prevent building or testing the shipped assets. No exclusive copyright in all
AI-generated output or third-party clearance is asserted; the project licenses
apply only to rights the contributor can grant.

No downloaded icon set, font or third-party raster library is bundled as
project artwork. The UI uses system fonts and app-specific CSS/SVG. npm
dependencies retain their own licenses; see [third-party notices](../THIRD_PARTY_NOTICES.md).

License references: [PolyForm's official terms](https://polyformproject.org/licenses/noncommercial/1.0.0),
[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/), and
[Creative Commons' software guidance](https://creativecommons.org/faq/#can-i-apply-a-creative-commons-license-to-software).
