# Subtitle

A Windows CEP panel for timing subtitle PNGs on a dedicated Premiere video track.

## Install

Close Premiere, run `install_extension.bat`, restart Premiere, and open **Window > Extensions > Subtitle**. After updating an installed copy, restart Premiere to load both the panel and host script.

## Subtitle shortcuts

Choose the subtitle video track, then click **Activate Subtitle Shortcuts**. Only while active and Premiere is foreground:

| Key | Action |
| --- | --- |
| Left Arrow | Extend the next subtitle's beginning to the playhead; shorten the current subtitle if necessary. The next subtitle's end stays fixed. |
| Right Arrow | Extend the previous subtitle's end to the playhead; move the covering subtitle's start to the playhead if necessary. The previous subtitle's start stays fixed. |
| [ | Trim the subtitle under the playhead from the left: its new start is the playhead, its end stays fixed. |
| ] | Trim the subtitle under the playhead from the right: its new end is the playhead, its start stays fixed. |
| Ctrl+Z | Undo the most recent tool edit, including both boundaries affected by an advance. |
| Ctrl+Shift+Z | Redo the most recently undone tool edit. |

For [ and ], put the playhead strictly inside a subtitle. No selection is necessary. Gaps and exact boundaries are rejected to prevent zero-duration clips. L and R, modified brackets, and modified arrows retain their normal function. Each physical press triggers one action, without key-repeat edits.

Deactivate to release all shortcuts to Premiere, including the arrow/bracket shortcuts and Ctrl+Z. Panel buttons also work while inactive. While active, the shortcuts apply throughout Premiere, so deactivate before typing into text fields or performing unrelated edits.

## Undo and overlap safety

**This CEP tool has its own history. Premiere's Edit > Undo/Redo menus do not undo these edits as a group.** While the tool is active, Ctrl+Z/Ctrl+Shift+Z are routed to the tool's history, not Premiere's. With no tool history, those keys report that there is nothing to restore; they do not fall through to an unrelated Premiere edit. Use the panel's Undo/Redo buttons when inactive.

Each successful tool edit records the track's clip identities, timeline boundaries and available source in/out points. Undo/redo resolves fresh clip references and verifies the entire track against that record before restoring anything. It refuses restoration if a clip was replaced, removed or changed outside the tool. Failed edits attempt to restore their complete pre-edit state; failed restoration reports an error instead of claiming success. Reactivation preserves history, but closing/reloading the panel or restarting Premiere clears it. Save a project backup before a subtitle timing session.

The tool rejects existing overlaps on the selected track and refuses imports into occupied ranges. It does not modify clips on other tracks or repair pre-existing corruption. Multiple visible subtitle tracks can still display subtitles simultaneously. Restore already damaged timings from a known-good project backup; the old tool did not save enough information to reconstruct them after its history was lost.

## Import and align missing extra subtitles

In **Extra subtitles**, choose the original subtitle track and click **Import & Align Extra Subs**. The importer first detects the track with the most PNGs in matching filename groups. Each group needs at least three clips with a common prefix and trailing numbers of three or more digits in increasing or decreasing timeline order; gaps are allowed. Existing variants whose base is in the sequence are excluded. A styled confirmation shows the detected track, count, and the new track to be created directly above it before importing. Normal confirmations omit filenames; issue details are shown only when needed. Only matching groups on the confirmed track are used. Ties or no clear match offer the selected manual track with confirmation. If the sequence or source clips change after detection, import stops for a fresh confirmation. A new destination track is created directly above it.

When missing extras are found and their timing plan is valid, the tool creates one new video track directly above the selected originals. Existing higher tracks shift up; their clips remain on their original tracks. The tool checks the new track position, existing clip states, track identities, and unchanged audio-track count before importing. No missing extras means no new track. Track creation uses Premiere's internal QE API because CEP's public API does not expose track insertion; an unsupported or unexpected result stops before importing clips.

No PNG folder selection is needed: each original's source folder is located automatically, including originals from multiple folders. Importing releases the keyboard shortcuts; activate them again when ready. The manual source selector follows the selected original track for timing edits and undo. Undo removes the imported batch but leaves the new empty track available; a failed import may also leave the empty track.

The feature matches the entire filename within each original's folder, case-insensitively: `Full name.png` is the original for `Full name_1.png`, `Full name_2.png`, etc. It does not group unrelated names that share a number, or mix identically named originals from different folders. Each source folder is scanned once, without searching subfolders. Only variant files missing from all video tracks in the active sequence are imported, using full media paths for identity (filename fallback only for clips without a readable media path). Items already in the project bin are reused. A standalone `Full name_1.png` already on the timeline is left alone; without `Full name.png` from the same folder on the selected original track, `Full name_2.png` is not treated as its extra. Unavailable source folders stop the import; relink the original PNGs in Premiere first.

Missing extras use one-second slots in numeric suffix order (rounded to whole sequence frames at fractional frame rates). For originals lasting **2 seconds or more**, the final extra ends exactly at the original's end: two extras for an original ending at 20 seconds occupy 18–19 and 19–20 seconds. For originals lasting **less than 2 seconds**, extras start at the original's end: an original ending at 20 seconds gets extras at 20–21 and 21–22 seconds. Extras may overlap other original subtitles in time on the lower track; originals are not changed.

One second is the preferred duration. If Premiere refuses to extend an extra to its full slot, a valid shorter clip is accepted. In the normal mode, it ends at its slot's end; after a short original, it starts at its slot's start. A shorter clip may leave unused space in that slot. Zero-length or longer-than-requested results are rejected. Undo/redo preserves the actual accepted lengths. Existing variants are not moved.

The entire placement plan is checked before any imports. Occupied destination ranges, colliding groups, repeated ambiguous originals, locked destination tracks, and placement before sequence start stop the operation. Each new still is initially placed in empty space beyond the destination track's last clip, resized on the timeline, and moved into its planned position. Source PNG in/out marks are not changed; the still-image default duration does not determine the final duration. Existing clips are never intentionally overwritten or shifted. An insertion failure attempts to remove only that batch's new timeline clips; imported project-bin items may remain.

**Undo/Redo Subtitle Edit** supports this batch with the original source track selected. Undo removes the newly placed clips without ripple; it leaves imported project-bin items available. History exists only for the current panel session, just like the timing edits. Already present variants and originals are not changed. The status shows imported, already-present, and unmatched counts.

## Optional import of all numbered PNGs

In the separate **Subtitle your sequence** section, Activate Subtitle Shortcuts appears at the top and the numbered-PNG importer is always visible. Choose a folder of numbered PNGs, select Import to track with an empty destination range, deactivate shortcuts, and click **Import All PNGs at Playhead**. Files are placed consecutively for one second each. Missing numbers are skipped; variants precede the next base number, e.g. `0623.png`, `0623_1.png`, `0623_2.png`, `0624.png`. Existing track clips work without importing anything.

**Import All PNGs at Playhead** uses Premiere's separate edit history, not the tool's timing history. Keep a project backup before bulk imports.

## Tests

Run `npm test` for host and panel regressions. Tests cover advance, both trims, undo/redo, reactivation, stale identities, unrelated timeline changes, overlap rejection, rollback after rejected writes, and mixed shortcut ordering. These are mocked host tests; actual Premiere behavior requires a disposable test sequence.

Compile `native/KeyListener.cs` with `tests/KeyListenerTests.cs`, selecting `/main:KeyListenerTests`, to run keyboard mapping tests. `build_key_listener.bat` builds the production helper.

Extra PNGs receive Premiere's red-toned label (Rose in the default palette) before timeline insertion, including redo. This labels their project-bin items too. Original PNG labels are unchanged. The optional numbered-PNG importer has its own destination track selector.

Shortcut mode automatically turns off when another keyboard key is pressed in Premiere. Plain arrow keys, Space, brackets, and the tool's undo/redo combinations keep it active; Ctrl/Shift prefixes are allowed for undo/redo. The triggering key continues to Premiere. Click Activate Subtitle Shortcuts to resume.

Extra subtitles and Subtitle your sequence are separate tabs. Both use the same panel scrollbar; status and manual controls remain shared below the active tab. The last selected tab is remembered.

Track insertion verifies the actual new track position before importing: selecting V14 keeps originals on V14 and places extras on new V15. If QE interprets the position differently, the tool removes only its verified new empty track, adjusts the insertion position once, and verifies again. No PNGs are placed unless the destination is directly above the source and all original tracks are preserved.

## Updates and releases

Version 1.7.3 checks for updates when the panel opens. Click **Update CEP** to download and verify files in the background. Save your project and close Premiere when prompted; the helper updates the existing %APPDATA%\Adobe\CEP\extensions\Subtitle folder automatically, then you can reopen Premiere. No ZIP extraction or manual installer is needed. Existing files are backed up under %LOCALAPPDATA%\PremiereSubtitleNavigator\updates; failed installations restore changed files. The helper never closes Premiere itself.

Updates are explicit and delayed until Premiere exits. The helper must confirm readiness before the panel says the update is ready. Pending/failed attempts survive panel reopens; failed attempts show Retry update and retain helper.log. Each version prompts once, while its update banner stays available. Every release has matching package/CEP/release versions, a versioned commit and tag, and SHA-256 hashes generated by node scripts/build-release.js. Initial installation still uses install_extension.bat. GitHub access for updates is public and needs no login.
