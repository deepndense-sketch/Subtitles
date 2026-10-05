## 1.9.4

- Show the large extras number without a box and place the result below track information.

## 1.9.3

- Hide the redundant explanation beneath the zero-extras badge.

## 1.9.2

- Show the extras count as a large badge; use green for extras found and neutral styling for zero.

## 1.9.1

- Make the empty search result say "0 extras found", without confusing skipped/unmatched counts.

## 1.9.0

- Search for extra PNGs before confirmation; show exact import count, planned track, and green/red timing counts. Recheck the plan at import.
- Label extras green within parent timing and red outside it; preserve original subtitles.

## 1.8.1

- Respect the selected extra-subtitle source track, confirm its total PNG clip count, and stop rather than switching to another track when the selection is invalid.

## 1.8.0

- Add read-only Sync with local in Adjust/Add Sub: compare PNG source folders with the active sequence, listing missing sequence files, missing disk files, and inaccessible folders by path.

## 1.7.5

- Show the actual total PNG clip count on the detected track, including repeated and unnumbered PNG clips, instead of presenting the detector score as a total.

# Changelog

## 1.7.4

- Add a colon to the main subtitle track label for an update-flow test.

## 1.7.3

- Use the ExportBackup-style independent hidden PowerShell launcher so the helper starts and survives the panel closing.

- Wait for the installer helper to confirm readiness; capture errors and time out failed launches.
- Persist pending updates, block duplicate attempts, and show failures with Retry update.
- Read the installed version fresh and clear obsolete notices; remember shown prompts across panel reopens.
- Check GitHub when the panel opens; monitor installation status without hourly network polling.

## 1.7.2

- Change the Extra Sub track label to Your main subs are at.

## 1.7.1

- Shorten the Extra Sub track label to Choose main sub track.

## 1.7.0

- Replace manual ZIP downloads with Update CEP: prepare verified files and install directly after Premiere closes.
- Keep a backup and restore changed files if installation fails.
- Add cache-busting update checks and per-file SHA-256 validation.

## 1.6.1

- Clarify the Extra Sub track label: Choose the track where your main subs are.

## 1.6.0

- Check for published updates when the panel opens and hourly while it stays open.
- Show an update prompt when subtitle editing is inactive, with a persistent download notice and installation steps.
- Display the installed version and record versioned commit/tag requirements.
- Includes the Subtitle panel, numbered-PNG import, reversible subtitle timing edits, confirmed source-track detection, and aligned red-label extra subtitles.
