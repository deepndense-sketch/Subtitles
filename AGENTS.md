# Subtitle release rules

- Every GitHub commit must include the version in its subject, for example `v1.6.0: Add update notifications`.
- Increment the version for each published update: patch for fixes/design changes, minor for features.
- Keep package.json, CSXS/manifest.xml, release.json, displayed status version, and CHANGELOG.md synchronized.
- Run npm test and check panel JavaScript syntax before publication.
- Tag published versions as vX.Y.Z and push the tag with the commit. The updater downloads verified files from that tag and installs them after Premiere closes. Run node scripts/build-release.js after final edits; commit the generated hashes.
- Maintain automatic update checks and an explicit download/install action. Never silently replace a running extension.
- Exclude backups, temporary files, credentials, and local project/media paths from GitHub.
- Preserve extension IDs and the native state-folder name for compatibility; the installed CEP folder and display name are Subtitle.
