document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const changelogLink = document.getElementById('changelogLink');
  const permissionNote = document.getElementById('permissionNote');

  // Site access is optional: Chrome asks for classroom.google.com only when the
  // user clicks, never at install.
  const CLASSROOM_ORIGIN = 'https://classroom.google.com/*';
  let accessGranted = false;

  function render() {
    if (startBtn) {
      startBtn.textContent = accessGranted ? 'Open Google Classroom' : 'Enable on Google Classroom';
    }
    if (permissionNote) {
      permissionNote.textContent = accessGranted
        ? 'Enabled. Classroom++ now runs on Google Classroom — open a Classwork tab to see it.'
        : 'Chrome will ask for access to classroom.google.com once. Classroom++ only reads the page you are already on, and never sends anything anywhere.';
    }
  }

  function setAccessState(granted) {
    accessGranted = Boolean(granted);
    render();
  }

  function checkAccess() {
    if (!chrome.permissions || !chrome.permissions.contains) return setAccessState(false);
    chrome.permissions.contains({ origins: [CLASSROOM_ORIGIN] }, (granted) => {
      setAccessState(Boolean(granted) && !chrome.runtime.lastError);
    });
  }

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      if (accessGranted) {
        chrome.tabs.create({ url: 'https://classroom.google.com/' });
        return;
      }
      // Must run straight from the click: Chrome only prompts for a gesture.
      chrome.permissions.request({ origins: [CLASSROOM_ORIGIN] }, (granted) => {
        if (chrome.runtime.lastError || !granted) return;
        setAccessState(true);
        // The background worker registers the content script and refreshes any
        // Classroom tab that is already open.
        chrome.runtime.sendMessage(
          { type: 'classroom-access-changed', granted: true },
          () => void chrome.runtime.lastError
        );
      });
    });
  }

  if (changelogLink) {
    changelogLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'changelog.html' });
    });
  }

  checkAccess();
});
