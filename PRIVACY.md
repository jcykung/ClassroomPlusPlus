# Privacy Policy — Classroom++

Last updated: October 30, 2026

Classroom++ is a browser extension that restyles the Google Classroom Classwork tab and
adds bulk selection to the "To review" page. It is a personal, non-commercial project.

## What the extension collects

**Nothing.** Classroom++ does not collect, transmit, sell or share any personal data.

- No analytics, tracking pixels, telemetry or advertising.
- No accounts, sign-in, or identifiers.
- No network requests of its own: the extension never contacts a server. All of its
  code, styles, icons and fonts ship inside the extension package (no remote scripts
  and no remotely hosted assets).
- No data leaves your browser.

## What is stored, and where

Classroom++ saves its own settings in Chrome's built-in `chrome.storage.sync`, which is
managed by Chrome and, if you have Chrome Sync enabled, synchronised by Google like your
other browser settings:

| Setting | Purpose |
| --- | --- |
| `classworkLayout` | Whether the Classwork tab layout is applied |
| `bulkReview` | Whether bulk select appears on the To review page |
| `isReversed` | Whether the Reverse order button is on |

These are booleans (plus the one-shot `firstRun` flag). They contain no personal data.
You can delete them at any time by removing the extension, or by clearing the
extension's storage in `chrome://extensions`.

## How the extension interacts with pages

The content script runs only on `https://classroom.google.com/*`. It reads the page to
find topic sections, posts and "View more" buttons so it can lay them out and, at your
request, expand them. That information stays in the page: it is never copied into
storage and never sent anywhere.

Bulk select on the "To review" page clicks the same "Mark as reviewed" menu item you
would click yourself, only for the rows you selected.

## Permissions and why they are needed

| Permission | Why |
| --- | --- |
| `storage` | Save the three toggles above with Chrome's sync storage |
| `https://classroom.google.com/*` | Run the content script on Classroom, and refresh open Classroom tabs when you change a setting in the popup |

No other permissions are requested. There is no `tabs`, `history`, `bookmarks`,
`cookies` or `<all_urls>` access.

## Children's data

The extension does not collect data from anyone, including students. It does not read
or store student work beyond rendering it on the page you are already viewing.

## Changes

Any change to this policy will be published in this file in the project repository
(https://github.com/jcykung/betterclassroom) and in the next extension release.

## Contact

Jonathan Kung — open an issue at https://github.com/jcykung/betterclassroom/issues.
