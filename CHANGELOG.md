## 1.9.11

- Import extras into calculated equal time slots without trimming the main clip or any existing extra. Keep the last extra aligned to the reference clip end so users can move extras down to cut manually.
- Undo/redo changes only the newly imported extras. Keep destination collision protection.

## 1.9.10

- Split the main clip equally with extras on the first import. Later additions split only the highest-numbered existing extra, preserving the main and earlier extras. The new highest suffix ends at the divided clip's previous end.
- Restore split clips on failed imports and undo; validate affected tracks and preview timing before edits. Preserve split history across later track insertion and redo.

## 1.9.9

- Reserve timing slots for the full numeric extra group, including variants already imported. A missing lower suffix no longer takes the final slot belonging to the highest suffix. Existing clips remain unchanged.

## 1.9.8

- Detect stalled update helpers through periodic status timestamps; cancel stale jobs and offer Retry instead of leaving Update pending indefinitely.
- Show readable Windows installer restriction errors while retaining raw helper logs for diagnosis.

## 1.9.7

- Publish the extra-subtitle timing and duration-color fixes under a new version so installations already running 1.9.6 receive an update offer.
- Extras share the original duration equally and finish at its unchanged end; clips below one second are red, and clips at least one second long are green.

## 1.9.6

- Divide original duration into equal original-plus-extra portions, ending the last extra at the unchanged original end. Label actual extras red below one second and green at or above one second; update preview and regression coverage.

- Synchronize clip source in/out spans with timeline duration during edits and Extra Sub placement, and verify them after moving each imported PNG. Keep reused-PNG shorter-duration fallback and avoid changing project-bin in/out marks.
- Normalize stale source duration in the undo snapshot for edited still PNGs, so undo restores the previous visible timing without reintroducing the old duration mismatch.

- Add a guarded overlap-repair preview for PNG subtitle tracks. Trim overlong tails to the next clip, preserve starts and other clips, verify the result, and support undo/redo. Refuse stale previews and ambiguous same-start stacks.
- Reapply saved timeline bounds after restoring source in/out points, preventing source setter side effects from leaving shifted bounds during undo or rollback.
- Explain existing overlaps with a recovery action instead of only directing users to a backup.

## 1.9.5

- Accept repeated original PNGs: merge touching split pieces for timing and anchor each missing extra once to the final occurrence. Preserve originals and duplicate-import protection. Show repeated-original handling as a note without blocking import.

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
