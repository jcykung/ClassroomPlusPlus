document.addEventListener('DOMContentLoaded', () => {
  const toggleReverse = document.getElementById('toggleReverseOrder');
  const toggleCentering = document.getElementById('toggleSmartCentering');
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
  chrome.storage.sync.get(['isReversed', 'smartCentering'], (result) => {
    if (toggleReverse) {
      toggleReverse.checked = result.isReversed === true;
    }
    if (toggleCentering) {
      toggleCentering.checked = result.smartCentering !== false; // default true
    }
  });

  // Handle setting updates
  function saveSettings() {
    const isReversed = toggleReverse ? toggleReverse.checked : false;
    const smartCentering = toggleCentering ? toggleCentering.checked : true;

    chrome.storage.sync.set({ isReversed, smartCentering }, () => {
      if (statusEl) {
        statusEl.textContent = 'Settings saved and synced!';
        statusEl.style.color = '#16803c';
        setTimeout(() => {
          statusEl.textContent = 'Settings sync automatically across all your devices.';
          statusEl.style.color = '#718096';
        }, 1800);
      }
    });
  }

  if (toggleReverse) {
    toggleReverse.addEventListener('change', saveSettings);
  }
  if (toggleCentering) {
    toggleCentering.addEventListener('change', saveSettings);
  }
});

