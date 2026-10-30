# Classroom++

A Chrome extension (Manifest V3) that makes the **Classwork** tab of Google Classroom easier to
work with and speeds up marking on the **To review** page.

Not affiliated with, endorsed by, or sponsored by Google. Google Classroom is a trademark of
Google LLC.

## What it does

### Classwork layout

- **5-post topic windows.** Topics with more than 5 posts become their own scroll area showing 5
  posts at a time; shorter topics are left untouched. **View all** / **View fewer** expands a
  topic in place.
- **Everything loaded.** Google's hidden "View more" batches are fetched automatically, so the
  newest published post is always present and every post is scrollable.
- **Newest post centred.** Each topic scrolls so the latest *published* post (not a draft) sits in
  the middle of the 5-post window, with upcoming drafts right below it.
- **Reverse order.** A button placed to the left of Google's "Collapse all" flips the post order in
  every topic; its look is copied from that button at runtime.
- **Editing stays visible.** Opening a post grows its scroll area by exactly the amount the post
  grew, so the whole post is visible.
- **Works in every class.** Enhancement is applied in any class, archived ones included. A class
  you have already visited keeps its layout, so returning to it is instant and nothing is fetched
  twice.

### To review: bulk select

- A checkbox on every assignment that can be marked reviewed, with **Select all** and a floating
  action bar.
- **Mark N as reviewed** clicks the same "Mark as reviewed" menu item you would click, one row at a
  time, then reports how many were marked.
- **Shift-click** selects a continuous range of rows; shift-clicking a checked row clears the range.
- Rows already reviewed, and the To-do sidebar, are never touched.

### Settings

Two switches in the popup, stored in `chrome.storage.sync`:

| Switch | Effect |
| --- | --- |
| **Classwork Layout** | Master switch for every Classwork change above |
| **Bulk Select on To Review** | The checkboxes and action bar on the To review page |

Changing a switch refreshes any open Classroom tabs so the new layout is live immediately.

## Scope and privacy

- Runs **only** on `https://classroom.google.com/*`; requests only `storage` plus that one host.
- Home, Stream, Calendar, People and the To-do page are left exactly as Google renders them.
- No analytics, no accounts, no network requests, no remote code or fonts — everything ships in the
  package and runs locally. See [PRIVACY.md](PRIVACY.md).

## Install (developer mode)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this directory (the one containing `manifest.json`).
3. Open any Google Classroom **Classwork** page.

> After changing code, press the ⟳ reload button on the Classroom++ card, then refresh Classroom.

## Testing

```sh
sh tests/run.sh
```

Runs four headless-Chrome fixture suites and prints PASS/FAIL for each assertion:

| Fixture | Covers |
| --- | --- |
| `tests/classwork-fixture.html` | Windows, centring, drafts, View all/fewer, collapse anchoring, loading labels, class switches, parked views, the layout switch |
| `tests/to-review-fixture.html` | Bulk select, shift-range, select all, marking reviewed, the popup switch |
| `tests/stream-fixture.html` | Class Stream is never enhanced; parked Classwork views keep their layout |
| `tests/archived-classwork-fixture.html` | Archived class with no topics and no selected tab is still enhanced |

## Packaging for the Chrome Web Store

```sh
sh tools/package.sh     # -> dist/classroom-plus-plus-<version>.zip
```

The archive contains only runtime files (manifest, popup, background, onboarding, changelog,
icons, `src/`). Test fixtures, screenshots, developer docs and local Classroom captures are
excluded.

Submission copy, permission justifications, data-usage answers and the review checklist live in
[`store/listing.md`](store/listing.md).

## Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 definition, permissions, CSP |
| `background.js` | Install/update lifecycle (defaults, welcome screen, changelog) |
| `src/content.js` | All page behaviour: detection, 5-post windows, loading, To review bulk select |
| `src/content.css` | Scoped styles for the windows, toggles, overlay and To review UI |
| `popup.html` / `popup.js` | The extension popup with the two switches |
| `onboarding.html` / `onboarding.js` | Welcome screen |
| `changelog.html` / `changelog.js` | Changelog |
| `icons/` | 16/32/48/128 px icons |
| `tests/` | Fixture suites and the runner |
| `tools/package.sh` | Builds the Web Store zip |
| `tools/make-icons.py` | Regenerates the icon set |
