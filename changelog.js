document.addEventListener('DOMContentLoaded', () => {
  const welcomeBtn = document.getElementById('welcomeBtn');
  if (welcomeBtn) {
    welcomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'onboarding.html' });
    });
  }
});

