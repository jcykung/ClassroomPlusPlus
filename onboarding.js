document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const changelogLink = document.getElementById('changelogLink');

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://classroom.google.com/' });
    });
  }

  if (changelogLink) {
    changelogLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'changelog.html' });
    });
  }
});

