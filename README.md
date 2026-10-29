# Classroom++

A Chrome extension that enhances the **Classwork** section of Google Classroom.

## What it does

1. **Limit 5 posts visible per Topic by default:**
   - Topics with more than 5 posts are limited to a clean 5-post visible window.
   - Click the **"View all"** button under any Topic to expand and show all posts in that topic. Click **"View fewer"** to collapse back down.
   - Topics with 5 or fewer posts are left completely untouched.

2. **Scrollable Topic sections:**
   - Each Topic section is scrollable independently so you can smoothly scroll through all posts in each topic without the whole page shifting (`overscroll-behavior: contain`).

3. **Latest post (not drafts) centered as the 3rd post of 5:**
   - By default, whenever you open or navigate to the **Classwork** tab (or exit and come back), each Topic automatically shows 5 posts and scrolls so that the **latest published post (not drafts)** is aligned to the **middle** of the scroll window (the 3rd post of the 5 showing).
   - This keeps what came before (previous 2 posts) and what needs to be edited and posted next (upcoming drafts) immediately visible in context!

4. **Automatic Unhiding & Removal of Google's "View more" buttons:**
   - Google Classroom natively truncates topic sections and hides older posts behind a "View more" link. Classroom++ automatically expands all hidden posts in every topic before applying the scroll window, ensuring you can scroll through *all* your posts.
   - Google's native "View more" buttons are cleanly hidden and replaced with Classroom++'s custom "View all" toggle.

5. **Reliable Single-Page App (SPA) Detection:**
   - Detects Classroom topic headers (`h2`), `[data-topic-id]`, `[data-stream-item-id]`, and deep links seamlessly.
   - Hooks into SPA navigation (`pushState`, `popstate`, `hashchange`, and tab clicks) so that when you exit and return to Classwork, topics cleanly reset to their default 5-post centered view.

## Install (Developer mode)

1. Open `chrome://extensions` in Google Chrome.
2. Enable **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked** and select this directory (the one containing `manifest.json`).
4. Navigate to any Google Classroom **Classwork** page (`classroom.google.com`).

> **Tip:** Whenever you make code updates, visit `chrome://extensions` and click the ⟳ reload button on Classroom++.

## Files

| Path | Purpose |
| ---- | ------- |
| `manifest.json` | Extension manifest (Manifest V3). |
| `src/content.js` | Topic detection, draft exclusion, middle alignment, and View all toggle. |
| `src/content.css` | Injected styles for scroll window, scrollbars, chevrons, and toggle button. |
| `icons/icon*.png` | Toolbar and extension icons. |
| `tests/classwork-fixture.html` | Interactive test fixture with automated verification suite. |

## Verification & Testing

Open `tests/classwork-fixture.html` in Chrome or run the test fixture to verify all test suites:
- Topic height fits exactly 5 posts.
- Draft items are excluded from latest-post calculation.
- Latest published post is centered as the 3rd of 5 visible posts.
- "View all" expands all posts and toggles to "View fewer".
- Navigation resets restore the 5-post centered view.
