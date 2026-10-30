document.addEventListener('DOMContentLoaded', () => {
  const toggleLayout = document.getElementById('toggleClassworkLayout');
  const toggleBulkReview = document.getElementById('toggleBulkReview');
  const statusEl = document.getElementById('statusMessage');
  const tipBtn = document.getElementById('tipBtn');
  const welcomeLink = document.getElementById('welcomeLink');
  const versionLink = document.getElementById('versionLink');

  // Tip Me button (Ko-Fi)
  if (tipBtn) {
    tipBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://ko-fi.com/coolpuddytat' });
    });
  }

  // Welcome Screen
  if (welcomeLink) {
    welcomeLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'onboarding.html' });
    });
  }

  // Version link -> Changelog
  if (versionLink) {
    const manifestVersion = chrome.runtime.getManifest().version;
    versionLink.textContent = `v. ${manifestVersion}`;
    versionLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'changelog.html' });
    });
  }

  // Load saved settings from sync storage
  chrome.storage.sync.get(['classworkLayout', 'smartCentering', 'bulkReview'], (result) => {
    if (toggleLayout) {
      // `smartCentering` is the key this switch used before it covered the
      // whole Classwork layout; honour it for people who already set it.
      const saved = typeof result.classworkLayout === 'boolean' ? result.classworkLayout : result.smartCentering;
      toggleLayout.checked = saved !== false; // default true
    }
    if (toggleBulkReview) {
      toggleBulkReview.checked = result.bulkReview !== false; // default true
    }
  });

  // Settings are read once when the page loads, so every open Classroom tab has
  // to be refreshed for a change to apply. Bursts of toggles reload only once.
  let reloadTimer = 0;
  function reloadClassroomTabs() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = 0;
      if (!chrome.tabs || !chrome.tabs.query) return;
      chrome.tabs.query({ url: 'https://classroom.google.com/*' }, (tabs) => {
        for (const tab of tabs || []) {
          if (typeof tab.id === 'number') chrome.tabs.reload(tab.id);
        }
      });
    }, 150);
  }

  // Handle setting updates. Reverse Order has no switch here (its button lives
  // on the Classwork page), so only the switches that exist are written — this
  // must never overwrite isReversed with a default.
  function saveSettings() {
    const settings = {};
    if (toggleLayout) settings.classworkLayout = toggleLayout.checked;
    if (toggleBulkReview) settings.bulkReview = toggleBulkReview.checked;

    chrome.storage.sync.set(settings, () => {
      if (statusEl) {
        statusEl.textContent = 'Settings saved and synced!';
        statusEl.style.color = '#16803c';
        setTimeout(() => {
          statusEl.textContent = 'Settings sync automatically across all your devices.';
          statusEl.style.color = '#718096';
        }, 1800);
      }
      reloadClassroomTabs();
    });
  }

  if (toggleLayout) {
    toggleLayout.addEventListener('change', saveSettings);
  }
  if (toggleBulkReview) {
    toggleBulkReview.addEventListener('change', saveSettings);
  }
});

