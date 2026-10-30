/**
 * Classroom++ — background service worker.
 *
 * Handles extension install and update lifecycle:
 * - On first install: initializes sync settings and launches onboarding.html.
 * - On update: opens changelog.html so users can view the new features.
 */

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      isReversed: false,
      visiblePosts: 5,
      classworkLayout: true,
      bulkReview: true,
      firstRun: true
    });
    chrome.tabs.create({ url: 'onboarding.html' });
  } else if (details.reason === 'update') {
    // Automatically open the changelog page on update
    chrome.tabs.create({ url: 'changelog.html' });
  }
});

