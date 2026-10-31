/**
 * Classroom++ — background service worker.
 *
 * Handles extension install and update lifecycle:
 * - On first install: initializes sync settings, reloads any open Classroom tabs
 *   so the content script is active immediately, and launches onboarding.html.
 * - On update: opens changelog.html so users can view the new features.
 */

/**
 * Reload every open Google Classroom tab so the content script is injected
 * immediately after install instead of waiting for the user to refresh.
 */
function reloadClassroomTabs() {
  if (!chrome.tabs || !chrome.tabs.query) return;
  chrome.tabs.query({ url: 'https://classroom.google.com/*' }, (tabs) => {
    // Swallow "no tab" races and missing host access instead of logging noise.
    if (chrome.runtime.lastError) return;
    for (const tab of tabs || []) {
      if (typeof tab.id !== 'number') continue;
      chrome.tabs.reload(tab.id, {}, () => void chrome.runtime.lastError);
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      isReversed: false,
      visiblePosts: 5,
      classworkLayout: true,
      bulkReview: true,
      firstRun: true
    });
    // Refresh right away rather than after the sync write settles: waiting on
    // storage can land the reload a few seconds later, just as the user is
    // opening a class, which looked like a second, unexpected refresh.
    reloadClassroomTabs();
    chrome.tabs.create({ url: 'onboarding.html' });
  } else if (details.reason === 'update') {
    // Automatically open the changelog page on update
    chrome.tabs.create({ url: 'changelog.html' });
  }
});

