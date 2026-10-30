/**
 * Classroom++ — content script.
 *
 * On Google Classroom's Classwork page:
 * 1. Loads every post of every Topic up front (clicking Google's "View more"
 *    until the topic is complete), then limits the visible posts to 5.
 *    (User can click "View all" to expand to show all posts in the Topic).
 * 2. Each Topic section is scrollable through all posts. Expanding a post
 *    grows the scroll window by the same amount, so the whole post stays
 *    visible while it is being edited.
 * 3. By default (on entering/returning to Classwork), scrolls so that
 *    the latest published post (not drafts) is aligned to the middle
 *    of the scroll (the 3rd post of the 5 showing), allowing the user to
 *    see what came before and what needs to be edited and posted next.
 * 4. The first time a class's Classwork is opened in a tab, the page reloads
 *    once so its posts are current. Returning to that class afterwards reuses
 *    the posts already on the page: the loading bar only appears when there is
 *    actually work to do.
 */
(() => {
  'use strict';

  const CONFIG = {
    /** How many posts fit in a collapsed topic window. */
    visiblePosts: 5,
    /** Topics with this many posts or fewer are left untouched. */
    minPostsToWindow: 6,
    /** Set true for console logging while debugging selectors. */
    debug: false,
  };

  const CLASS = {
    window: 'cpp-scroll-window',
    expanded: 'cpp-expanded',
    ui: 'cpp-ui',
    controls: 'cpp-controls',
    toggle: 'cpp-toggle',
    toggleText: 'cpp-toggle-text',
    toggleIcon: 'cpp-toggle-icon',
  };

  const VARS = {
    height: '--cpp-window-height',
  };

  const MAIN_SELECTOR = '[role="main"], main, #yDmH0d, body';

  /**
   * The main region of the view currently on screen.
   *
   * Classroom keeps previously visited classes' regions in the DOM, and they
   * come first in document order. Taking the first match therefore meant
   * enhancing a hidden copy of an older class while the class on screen stayed
   * untouched — which looked like the extension doing nothing until a reload.
   */
  function getMainElement() {
    const candidates = Array.from(document.querySelectorAll(MAIN_SELECTOR));
    for (const el of candidates) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.getClientRects().length) return el;
    }
    return candidates[0] || document.body;
  }
  const ROLE_ITEM_SELECTOR = 'li[data-stream-item-id], [data-stream-item-id], [role="listitem"]';
  const SKIP_ANCESTOR_SELECTOR =
    'aside, nav, [role="navigation"], [role="complementary"], [role="dialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [role="combobox"], .aqdrmf-rymPhb, [jscontroller="bZ0mod"], [data-is-select-menu="true"]';

  // Work item links: match assignment, material, question, post links in Google Classroom
  const WORK_LINK_RE = /(?:\/c\/|\/w\/|\/u\/\d+\/c\/|\/u\/\d+\/w\/)[^/]+\/(?:a|m|q|p)\/[^/]+/;

  // Selector for Google Classroom's native "View more" button
  const VIEW_MORE_SELECTOR = 'button[aria-label*="View more" i], [role="button"][aria-label*="View more" i]';

  const CHEVRON_SVG = `
    <svg class="${CLASS.toggleIcon}" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
    </svg>
  `.trim();

  const SORT_ICON_SVG = `
    <svg class="cpp-sort-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3L5 6.99h3V14h2V6.99h3L9 3zm7 14.01V10h-2v7.01h-3L15 21l4-3.99h-3z"/>
    </svg>
  `.trim();

  const SORT_STORAGE_KEY = 'cpp_reverse_order';
  let isReversed = (() => {
    try {
      return localStorage.getItem(SORT_STORAGE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  })();

  /**
   * Class ids whose Classwork posts have already been freshly loaded in this
   * browser tab. sessionStorage is deliberately tab-local: it is never synced
   * to another browser or device, and it disappears when the tab closes, so a
   * previous session can never make the extension skip loading a class.
   */
  const LOADED_CLASSES_STORAGE_KEY = 'cpp_loaded_classes';
  const loadedClassesFallback = new Set();

  function readLoadedClasses() {
    try {
      const raw = sessionStorage.getItem(LOADED_CLASSES_STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set();
    } catch (_) {
      return new Set(loadedClassesFallback);
    }
  }

  function rememberLoadedClass(classId) {
    if (!classId) return;
    loadedClassesFallback.add(classId);
    try {
      const loaded = readLoadedClasses();
      loaded.add(classId);
      sessionStorage.setItem(LOADED_CLASSES_STORAGE_KEY, JSON.stringify(Array.from(loaded)));
    } catch (_) {}
  }

  function hasLoadedClass(classId) {
    if (!classId) return true;
    if (loadedClassesFallback.has(classId)) return true;
    return readLoadedClasses().has(classId);
  }

  /** The class id from /c/<id>, /w/<id>, /u/<n>/c/<id> or /u/<n>/w/<id>. */
  function currentClassId() {
    const match = location.pathname.match(/\/(?:u\/\d+\/)?(?:c|w)\/([^/?#]+)/i);
    return match ? match[1] : '';
  }

  function saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ isReversed });
    }
    try {
      localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
    } catch (_) {}
  }

  /** Bulk "mark as reviewed" checkboxes on the To review page (on by default). */
  let bulkReviewEnabled = true;
  /** Master switch for every Classwork enhancement (on by default). */
  let classworkLayoutEnabled = true;

  /** Reads the Classwork Layout switch, honouring its pre-0.2.2 key. */
  function readClassworkLayout(result) {
    if (!result) return true;
    if (typeof result.classworkLayout === 'boolean') return result.classworkLayout;
    return result.smartCentering !== false;
  }

  function loadInitialSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.get(['isReversed', 'bulkReview', 'classworkLayout', 'smartCentering'], (result) => {
        if (result && typeof result.isReversed === 'boolean') {
          if (result.isReversed !== isReversed) {
            isReversed = result.isReversed;
            try {
              localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
            } catch (_) {}
            refreshSortButton();
            applySortOrderToAll();
          }
        }
        if (result && typeof result.bulkReview === 'boolean') {
          bulkReviewEnabled = result.bulkReview;
          updateReviewMode();
        }
        const layout = readClassworkLayout(result);
        if (layout !== classworkLayoutEnabled) {
          classworkLayoutEnabled = layout;
          scan();
        }
      });
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync' && changes.isReversed) {
        const newVal = changes.isReversed.newValue === true;
        if (newVal !== isReversed) {
          isReversed = newVal;
          try {
            localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
          } catch (_) {}
          refreshSortButton();
          applySortOrderToAll();
        }
      }
      if (area === 'sync' && changes.bulkReview) {
        bulkReviewEnabled = changes.bulkReview.newValue !== false;
        updateReviewMode();
      }
      if (area === 'sync' && changes.classworkLayout) {
        classworkLayoutEnabled = changes.classworkLayout.newValue !== false;
        scan();
      }
    });
  }

  const log = (...args) => {
    if (CONFIG.debug) console.log('[Classroom++]', ...args);
  };

  /** Track whether we're in the middle of expanding Google's hidden posts. */
  let isExpanding = false;
  /** Track whether we've injected our CSS to hide Google's View more. */
  let viewMoreCssInjected = false;

  // ── Loading overlay ──────────────────────────────────────────────────────

  let overlayEl = null;
  let overlayBar = null;
  let overlayLabel = null;
  let overlayHideTimer = null;

  /** How long to wait after the last setup activity before hiding the overlay. */
  const SETUP_QUIET_MS = 300;
  /** Hard cap per loading burst: the global overlay always hides after this long
   * unless batches are still arriving (see SETUP_ABSOLUTE_MAX_MS). */
  const SETUP_MAX_MS = 2500;
  /** Absolute cap for a single bulk load, however many batches it needs. */
  const SETUP_ABSOLUTE_MAX_MS = 60000;
  /** View more clicks can take a while on school networks; don't hang forever. */
  const EXPANSION_WAIT_TIMEOUT = 3500;

  let setupActive = false;
  let setupStartedAt = 0;
  let setupFinishTimer = 0;
  let setupHardTimer = 0;
  let pendingLayoutSettles = 0;

  function ensureOverlay() {
    if (overlayEl && overlayEl.isConnected) {
      // Re-use an overlay that is still fading out instead of creating a new one.
      clearTimeout(overlayHideTimer);
      overlayHideTimer = null;
      overlayEl.classList.remove('cpp-loading-done');
      overlayEl.classList.add('cpp-loading-visible');
      return;
    }

    overlayEl = document.createElement('div');
    overlayEl.className = 'cpp-loading-overlay';
    overlayEl.setAttribute('role', 'status');
    overlayEl.setAttribute('aria-live', 'polite');
    overlayEl.setAttribute('aria-label', 'Loading posts…');

    overlayLabel = document.createElement('div');
    overlayLabel.className = 'cpp-loading-label';
    overlayLabel.innerHTML = '<span class="cpp-loading-icon"></span><span class="cpp-loading-text">Loading posts…</span>';

    const track = document.createElement('div');
    track.className = 'cpp-loading-track';

    overlayBar = document.createElement('progress');
    overlayBar.className = 'cpp-loading-bar';
    overlayBar.setAttribute('aria-hidden', 'true');
    // Start indeterminate (no value attr) until we know total
    track.appendChild(overlayBar);

    overlayEl.appendChild(overlayLabel);
    overlayEl.appendChild(track);
    document.body.appendChild(overlayEl);

    // Trigger fade-in on next frame. The timeout is a fallback for cases where
    // requestAnimationFrame is throttled (background tab / headless render).
    const showOverlay = () => {
      if (overlayEl) overlayEl.classList.add('cpp-loading-visible');
    };
    requestAnimationFrame(() => requestAnimationFrame(showOverlay));
    setTimeout(showOverlay, 50);
  }

  /**
   * Start the global loading session. Only called when a topic actually has
   * posts left to fetch, so tabs/visits with everything already loaded show
   * no bar at all. The overlay always hides after SETUP_QUIET_MS of calm or
   * SETUP_MAX_MS per burst, whichever is first.
   */
  function beginSetup() {
    if (!setupActive) {
      setupActive = true;
      setupStartedAt = Date.now();
      ensureOverlay();
      // Absolute guarantee: the bar can never get stuck.
      clearTimeout(setupHardTimer);
      setupHardTimer = window.setTimeout(forceFinishSetup, SETUP_MAX_MS);
    }
    noteSetupActivity();
  }

  /** Push the overlay's dismissal back while initial setup work is happening. */
  function noteSetupActivity(extraMs = 0) {
    if (!setupActive) return;
    clearTimeout(setupFinishTimer);
    setupFinishTimer = window.setTimeout(finishSetupIfIdle, SETUP_QUIET_MS + extraMs);
  }

  function finishSetupIfIdle() {
    if (!setupActive) return;

    const timedOut = Date.now() - setupStartedAt > SETUP_MAX_MS;

    // Give the scan + scroll alignment a moment to settle.
    if (!timedOut && (isExpanding || scanTimer || pendingLayoutSettles > 0)) {
      noteSetupActivity();
      return;
    }

    forceFinishSetup();
  }

  function forceFinishSetup() {
    if (!setupActive) return;
    // Bulk-loading a big topic can take longer than the hard cap; keep the bar
    // alive while batches are still arriving (with an absolute overall limit).
    if (isExpanding && Date.now() - setupStartedAt < SETUP_ABSOLUTE_MAX_MS) {
      clearTimeout(setupHardTimer);
      setupHardTimer = window.setTimeout(forceFinishSetup, SETUP_MAX_MS);
      noteSetupActivity();
      return;
    }
    setupActive = false;
    clearTimeout(setupFinishTimer);
    setupFinishTimer = 0;
    clearTimeout(setupHardTimer);
    setupHardTimer = 0;
    hideOverlay();
  }

  function cancelSetup() {
    setupActive = false;
    pendingLayoutSettles = 0;
    clearTimeout(setupFinishTimer);
    setupFinishTimer = 0;
    clearTimeout(setupHardTimer);
    setupHardTimer = 0;
    if (overlayEl) hideOverlay();
  }

  /**
   * Track scroll-alignment retries so the overlay can't disappear while the
   * last layout adjustment is still pending.
   */
  function trackLayoutSettle() {
    if (!setupActive) return null;
    pendingLayoutSettles++;
    noteSetupActivity();

    let done = false;
    return () => {
      if (done) return;
      done = true;
      pendingLayoutSettles = Math.max(0, pendingLayoutSettles - 1);
      noteSetupActivity();
    };
  }

  /**
   * The overlay only says what it is doing. Classroom never tells us how many
   * posts a topic still holds behind "View more", so any number here is a
   * guess — the count was removed rather than kept inaccurate.
   */
  function updateOverlay() {
    if (!overlayEl) return;
    overlayBar.removeAttribute('value'); // stay indeterminate
    const text = overlayEl.querySelector('.cpp-loading-text');
    if (text) text.textContent = 'Loading posts…';
  }

  function hideOverlay() {
    if (!overlayEl) return;
    clearTimeout(overlayHideTimer);
    overlayEl.classList.add('cpp-loading-done');
    overlayEl.classList.remove('cpp-loading-visible');
    // Remove from DOM after fade-out transition (0.4s + 0.1s delay + buffer)
    overlayHideTimer = setTimeout(() => {
      if (overlayEl) { overlayEl.remove(); overlayEl = null; overlayBar = null; overlayLabel = null; }
    }, 650);
  }

  // ── End loading overlay ──────────────────────────────────────────────────

  /** @type {Set<Element>} - Post-list containers currently enhanced. */
  const activeContainers = new Set();
  /** @type {WeakMap<Element, {expanded: boolean, centered: boolean, items: Element[], ui: Element|null, button: Element|null, itemCount: number}>} */
  const stateByContainer = new WeakMap();

  /**
   * Determine if an element represents a Draft post in Google Classroom.
   */
  function isDraftItem(item) {
    if (!item || !item.nodeType) return false;

    // 1. Direct check: element with aria-label="Draft Assignment" or similar
    if (item.querySelector('[aria-label*="Draft" i]')) {
      return true;
    }

    // 2. Check aria-label of the item itself
    const ariaLabel = (item.getAttribute('aria-label') || '').toLowerCase();
    if (/\b(?:draft|brouillon|borrador|entwurf|rascunho|bozza|drafts)\b/i.test(ariaLabel) || ariaLabel.includes('草稿')) {
      return true;
    }

    // 3. Check for draft badge or chip element with exact text "Draft"
    const candidates = item.querySelectorAll('div, span, p, [role="status"]');
    for (const el of candidates) {
      if (el.children.length === 0) {
        const text = el.textContent.trim().toLowerCase();
        if (
          text === 'draft' ||
          text === 'drafts' ||
          text === 'saved as draft' ||
          text.startsWith('draft -') ||
          text === 'brouillon' ||
          text === 'borrador' ||
          text === 'entwurf' ||
          text === 'rascunho' ||
          text === 'bozza' ||
          text === '草稿'
        ) {
          return true;
        }
      }
    }

    // 4. Check for specific draft class names or data attributes
    if (
      (item.matches && item.matches('[class*="draft" i], [data-draft="true"]')) ||
      item.querySelector('[class*="draft" i], [data-draft="true"]')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Find the index of the latest published post (not drafts).
   * In a topic list:
   * Earlier items -> Latest published post -> Upcoming drafts to be edited next.
   * If there are no published posts (all drafts), returns -1 so the topic
   * scrolls to the beginning (scrollTop = 0) to start editing.
   */
  function findLatestPostIndex(items) {
    if (!items || items.length === 0) return -1;

    const publishedIndices = [];
    const draftIndices = [];
    for (let i = 0; i < items.length; i++) {
      if (isDraftItem(items[i])) {
        draftIndices.push(i);
      } else {
        publishedIndices.push(i);
      }
    }

    // If there are no published posts (all drafts), return -1
    // to scroll directly to the beginning (scrollTop = 0)
    if (publishedIndices.length === 0) return -1;

    // If there are drafts, check their placement relative to published posts
    if (draftIndices.length > 0) {
      const firstDraft = draftIndices[0];

      // If drafts are at the top (index 0), e.g. upcoming curriculum planning drafts:
      // The latest published post is the first published post after these top drafts
      if (firstDraft === 0) {
        return publishedIndices[0];
      }

      // If drafts are at the bottom (newly created draft posts placed at bottom by default):
      // The latest published post is the last published post before the drafts
      const beforeDrafts = publishedIndices.filter((idx) => idx < firstDraft);
      if (beforeDrafts.length > 0) {
        return beforeDrafts[beforeDrafts.length - 1];
      }
      return publishedIndices[0];
    }

    // Default / All published posts:
    // In sequence, the latest post is the last published post
    return publishedIndices[publishedIndices.length - 1];
  }

  /**
   * Align the scroll window so that the target post is the 3rd post of 5 visible posts
   * (aligned to the middle of the scroll). Supports both standard and reversed sort orders.
   * If targetIndex is -1 (e.g. topic with all drafts), scrolls directly to the top.
   */
  function alignLatestPostToMiddle(container, items, targetIndex, reversed = false) {
    if (!items || items.length === 0) return;

    markProgrammaticScroll(container, 800);

    // If no published posts (all drafts, targetIndex < 0), scroll to the very top
    if (targetIndex < 0) {
      container.scrollTop = 0;
      return;
    }

    // The 3rd post of 5 visible posts is items[targetIndex].
    // In normal order, top visible item is targetIndex - 2.
    // In reversed order, items are displayed reversed, so top visible item is targetIndex + 2.
    let topIndex;
    if (reversed) {
      topIndex = Math.min(items.length - 1, targetIndex + 2);
    } else {
      topIndex = Math.max(0, targetIndex - 2);
    }

    const topItem = items[topIndex];
    if (!topItem) {
      container.scrollTop = 0;
      return;
    }

    const applyScroll = () => {
      if (!container.isConnected || !topItem.isConnected) return;
      if (topItem.offsetParent === container) {
        container.scrollTop = topItem.offsetTop;
      } else {
        const cRect = container.getBoundingClientRect();
        const iRect = topItem.getBoundingClientRect();
        if (cRect.height === 0 || iRect.height === 0) return;
        const delta = iRect.top - cRect.top;
        container.scrollTop = Math.max(0, Math.round(container.scrollTop + delta));
      }
    };

    const settle = trackLayoutSettle();

    applyScroll();
    requestAnimationFrame(() => {
      applyScroll();
      setTimeout(applyScroll, 80);
      setTimeout(applyScroll, 200);
    });
    // Keep the overlay up until the final late-layout adjustment has run.
    setTimeout(() => {
      applyScroll();
      if (settle) settle();
    }, 500);
  }

  /**
   * Resolved pathname of an anchor's href.
   */
  function linkPath(a) {
    const raw = a.getAttribute('href');
    if (!raw || /^(?:javascript|mailto|tel|sms|#)/i.test(raw.trim())) return '';
    try {
      return new URL(raw, location.href).pathname;
    } catch (_) {
      return '';
    }
  }

  /**
   * Multi-strategy collection of Topic containers and their post lists:
   * Strategy 1 (Native Classroom): Outermost [data-topic-id] sections and their <ol> post lists.
   * Strategy 2 (Heading-based): <h2> topic headings and their associated post lists.
   * Strategy 3 (Role/Tag): <ol> or [role="list"] with [data-stream-item-id] or [role="listitem"].
   * Strategy 4 (Fallback): Work links matching assignment paths.
   */
  function collectGroups(main) {
    const groups = new Map();
    const seenContainers = new Set();

    // Strategy 1: Google Classroom native [data-topic-id]
    // Filter strictly to outermost topic containers only, excluding menus or nested elements
    const topicNodes = Array.from(main.querySelectorAll('[data-topic-id]')).filter((node) => {
      if (node.closest(SKIP_ANCESTOR_SELECTOR)) return false;
      if (node.parentElement && node.parentElement.closest('[data-topic-id]')) return false;
      return true;
    });

    for (const topicNode of topicNodes) {
      // Find the posts container: ol[jsname="bN97Pc"], ol.Xzp3fc, or ol
      let list = topicNode.querySelector('ol[jsname="bN97Pc"], ol.Xzp3fc, ol');
      if (!list) {
        list = topicNode.querySelector('ol, [role="list"]:not([role="menu"]):not([role="listbox"])');
      }
      if (!list) {
        // Look for element following the topic header
        const header = topicNode.querySelector('[jsname="K3jAGe"], .jLMcgc') || topicNode.firstElementChild;
        if (header && header.nextElementSibling) {
          list = header.nextElementSibling.matches('ol, ul, [role="list"]')
            ? header.nextElementSibling
            : header.nextElementSibling.querySelector('ol, ul, [role="list"]');
        }
      }

      if (list && !seenContainers.has(list)) {
        if (list.closest(SKIP_ANCESTOR_SELECTOR) || list.getAttribute('role') === 'menu') {
          continue;
        }

        // Only count direct LI children if it's an OL/UL, avoiding duplicate child tags
        let items = Array.from(list.children).filter(
          (c) => (c.tagName === 'LI' || c.getAttribute('role') === 'listitem') && !c.classList.contains(CLASS.ui)
        );

        if (items.length === 0) {
          items = Array.from(list.children).filter(
            (c) =>
              !c.classList.contains(CLASS.ui) &&
              !c.classList.contains(CLASS.controls) &&
              c.getBoundingClientRect().height > 10
          );
        }

        if (items.length > 0) {
          seenContainers.add(list);
          groups.set(list, items);
        }
      }
    }

    // Strategy 2: Heading-based (h2 in main)
    const headings = Array.from(main.querySelectorAll('h2, [role="heading"][aria-level="2"]')).filter(
      (h2) => !h2.closest(SKIP_ANCESTOR_SELECTOR)
    );

    for (const h2 of headings) {
      const topicSection =
        h2.closest('[data-topic-id], section, [aria-label*="Topic" i], [role="region"]') ||
        h2.parentElement;
      if (!topicSection || topicSection === main) continue;

      let list = topicSection.querySelector('ol[jsname="bN97Pc"], ol.Xzp3fc, ol');
      if (!list) {
        let sibling = (h2.closest('div') || h2).nextElementSibling;
        while (sibling) {
          if (
            sibling.matches &&
            (sibling.matches('ol, [role="list"]:not([role="menu"])') ||
              sibling.querySelector('ol, [role="list"]:not([role="menu"])'))
          ) {
            list = sibling.matches('ol, [role="list"]')
              ? sibling
              : sibling.querySelector('ol, [role="list"]');
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }

      if (list && !seenContainers.has(list)) {
        if (list.closest(SKIP_ANCESTOR_SELECTOR) || list.getAttribute('role') === 'menu') continue;

        let items = Array.from(list.children).filter(
          (c) => (c.tagName === 'LI' || c.getAttribute('role') === 'listitem') && !c.classList.contains(CLASS.ui)
        );
        if (items.length === 0) {
          items = Array.from(list.children).filter(
            (c) =>
              !c.classList.contains(CLASS.ui) &&
              !c.classList.contains(CLASS.controls) &&
              c.getBoundingClientRect().height > 10
          );
        }
        if (items.length > 0) {
          seenContainers.add(list);
          groups.set(list, items);
        }
      }
    }

    // Strategy 3: Any ol or [role="list"] containing items (excluding menus)
    const roleLists = Array.from(main.querySelectorAll('ol, [role="list"]')).filter(
      (l) => !seenContainers.has(l) && !l.closest(SKIP_ANCESTOR_SELECTOR) && l.getAttribute('role') !== 'menu'
    );
    for (const list of roleLists) {
      const items = Array.from(list.children).filter(
        (child) =>
          (child.tagName === 'LI' ||
            (child.matches && child.matches('[role="listitem"]')) ||
            child.querySelector('[role="listitem"]')) &&
          !child.classList.contains(CLASS.ui)
      );
      if (items.length >= 2) {
        seenContainers.add(list);
        groups.set(list, items);
      }
    }

    // Strategy 4: Link-based fallback (anchors with coursework paths)
    const allLinks = Array.from(main.querySelectorAll('a[href]')).filter(
      (a) => !a.closest(SKIP_ANCESTOR_SELECTOR) && WORK_LINK_RE.test(linkPath(a))
    );

    if (allLinks.length > 0) {
      const roots = new Set();
      for (const link of allLinks) {
        const roleItem = link.closest(ROLE_ITEM_SELECTOR);
        if (roleItem && main.contains(roleItem)) {
          roots.add(roleItem);
          continue;
        }
        let node = link;
        while (node.parentElement && node.parentElement !== main && node.parentElement !== document.body) {
          const parent = node.parentElement;
          const otherLinks = allLinks.filter((l) => parent.contains(l) && !node.contains(l));
          if (otherLinks.length > 0) break;
          node = parent;
        }
        if (node && node !== main) roots.add(node);
      }

      const rootList = Array.from(roots).filter(
        (r) => !Array.from(roots).some((o) => o !== r && o.contains(r))
      );

      for (const root of rootList) {
        const container = root.parentElement;
        if (!container || seenContainers.has(container)) continue;
        if (!groups.has(container)) groups.set(container, []);
        groups.get(container).push(root);
      }
    }

    return groups;
  }

  function shouldHandle(container, items) {
    if (container === document.body || container === document.documentElement) return false;
    if (!container.isConnected) return false;
    if (container.closest(SKIP_ANCESTOR_SELECTOR)) return false;
    if (items.length >= CONFIG.minPostsToWindow) return true;
    // Truncated topics (Google still holds unloaded posts behind "View more")
    // are enhanced even while small, so scrolling them loads the next batch
    // lazily instead of waiting for a manual "View more" click.
    try {
      if (findViewMoreForContainer(container)) return true;
    } catch (_) {}
    return false;
  }

  function gapBetween(items) {
    if (items.length >= 2) {
      try {
        const style = getComputedStyle(items[0].parentElement);
        const rowGap = parseFloat(style.rowGap || '');
        if (!Number.isNaN(rowGap) && rowGap > 0) return rowGap;
      } catch (_) {
        // fall through to bounding rects
      }
      const a = items[0].getBoundingClientRect();
      const b = items[1].getBoundingClientRect();
      return Math.max(0, b.top - a.bottom);
    }
    return 0;
  }

  /** Measure the collapsed window height so 5 posts fit exactly. */
  function measureWindow(items) {
    const sample = items.slice(0, CONFIG.visiblePosts);
    let heights = sample.map((el) => el.getBoundingClientRect().height);
    const validHeights = heights.filter((h) => h > 0);
    const fallbackHeight = validHeights.length > 0
      ? validHeights.reduce((sum, h) => sum + h, 0) / validHeights.length
      : 66;

    heights = heights.map((h) => (h > 0 ? h : fallbackHeight));
    const gap = gapBetween(items);
    const contentHeight = heights.reduce((sum, h) => sum + h, 0) + gap * (heights.length - 1);
    if (!(contentHeight > 40)) return null;
    return {
      windowHeight: Math.round(contentHeight),
      avgHeight: contentHeight / heights.length,
      gap,
    };
  }

  function getControlsAnchor(container) {
    const dragCtrl = container.closest('[jscontroller="CJc2td"], [data-drag-list-group-key]');
    if (dragCtrl) {
      const next = dragCtrl.nextElementSibling;
      if (next && next.classList.contains('Mvr5Ef')) {
        return next;
      }
      return dragCtrl;
    }
    return container;
  }

  function ensureControls(container, st) {
    let ui = st.ui;
    if (!ui) {
      ui = document.createElement('div');
      ui.className = `${CLASS.ui} ${CLASS.controls}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = CLASS.toggle;
      button.addEventListener('click', () => {
        const state = stateByContainer.get(container);
        if (!state) return;
        const wasExpanded = state.expanded;
        // Where the button sits on screen right now. Collapsing shrinks the
        // scroll window, which drags the button (and the page below it) up.
        const anchorY = button.getBoundingClientRect().top;
        setExpanded(container, state, !wasExpanded);
        if (wasExpanded) lockPageToToggle(container, anchorY);
      });

      const textSpan = document.createElement('span');
      textSpan.className = CLASS.toggleText;
      button.appendChild(textSpan);

      const iconWrap = document.createElement('span');
      iconWrap.innerHTML = CHEVRON_SVG;
      button.appendChild(iconWrap.firstElementChild);

      ui.appendChild(button);
      st.ui = ui;
      st.button = button;
    }

    const anchor = getControlsAnchor(container);
    if (!ui.isConnected || ui.previousElementSibling !== anchor) {
      anchor.insertAdjacentElement('afterend', ui);
    }

    // Toggle label: "View all" to expand, "View fewer" to collapse.
    const textLabel = st.expanded ? 'View fewer' : `View all (${st.itemCount})`;
    const textSpan = st.button.querySelector(`.${CLASS.toggleText}`);
    if (textSpan && textSpan.textContent !== textLabel) {
      textSpan.textContent = textLabel;
    }
    st.button.setAttribute('aria-expanded', String(st.expanded));
    st.button.setAttribute(
      'aria-label',
      st.expanded ? 'View fewer posts' : `View all ${st.itemCount} posts`
    );
  }

  /**
   * Collapsing a topic shrinks its scroll window by thousands of pixels, which
   * yanks the toggle button and everything under it up the page, leaving the
   * user somewhere near the bottom. Re-anchor the window scroll so the button
   * the user just clicked stays exactly where it was on screen.
   */
  function lockPageToToggle(container, anchorY) {
    const st = stateByContainer.get(container);
    const button = st && st.button;
    if (!button) return;

    // Our own last scroll position. If the page moved by anything else (the
    // user scrolled), stop fighting them.
    let expectedY = null;
    const adjust = () => {
      if (!button.isConnected) return;
      if (expectedY !== null && Math.abs(window.scrollY - expectedY) > 2) return;
      const delta = button.getBoundingClientRect().top - anchorY;
      if (Math.abs(delta) >= 1) {
        window.scrollTo({ top: window.scrollY + delta, behavior: 'instant' });
      }
      expectedY = window.scrollY;
    };

    // The height change lands synchronously, but Classroom's own layout can
    // settle a frame or two later, so re-anchor a few times.
    adjust();
    requestAnimationFrame(adjust);
    setTimeout(adjust, 80);
    setTimeout(adjust, 240);
  }

  function setExpanded(container, st, expanded) {
    if (st.expanded === expanded) return;
    st.expanded = expanded;
    if (!expanded) {
      container.classList.remove(CLASS.expanded);
      st.centered = false; // re-align to the latest post in the middle
      if (st.items && st.items.length) applyWindow(container, st.items);
    } else {
      container.classList.add(CLASS.expanded);
      markProgrammaticScroll(container, 250);
      container.scrollTop = 0;
      ensureControls(container, st);
    }
  }

  function teardown(container) {
    container.classList.remove(CLASS.window, CLASS.expanded);
    for (const prop of Object.values(VARS)) container.style.removeProperty(prop);
    const topicNode = topicNodeForContainer(container);
    if (topicNode) {
      for (const btn of topicNode.querySelectorAll('.cpp-native-view-more')) {
        btn.classList.remove('cpp-native-view-more');
      }
    }
    const st = stateByContainer.get(container);
    if (st && st.ui) st.ui.remove();
    if (st && st.heightObserver) st.heightObserver.disconnect();
    stateByContainer.delete(container);
    activeContainers.delete(container);
  }

  function applyWindow(container, items) {
    const rect = container.getBoundingClientRect();
    let st = stateByContainer.get(container);
    if (!st) {
      st = {
        expanded: false,
        centered: false,
        items: [],
        ui: null,
        button: null,
        itemCount: 0,
        /** Height currently applied to the scroll window. */
        windowHeight: 0,
        /** Height the 5-post window naturally needs (post expansion grows past it). */
        baseWindowHeight: 0,
        /** Natural height of each post at the time the window was measured. */
        baseItemHeights: null,
        /** Items currently watched for size changes by the height observer. */
        observedItems: null,
        heightObserver: null,
        heightSyncScheduled: false,
      };
      stateByContainer.set(container, st);
    }

    // Check if topic is collapsed by Google's native accordion or hidden
    const topicNode = container.closest('[data-topic-id]');
    const accordionBtn = topicNode ? topicNode.querySelector('button[jsname="ix0Hvc"]') : null;
    const isTopicCollapsed =
      (accordionBtn && accordionBtn.getAttribute('aria-expanded') === 'false') ||
      rect.width === 0 ||
      rect.height === 0;

    if (isTopicCollapsed) {
      if (st.ui) st.ui.style.display = 'none';
      return;
    }
    if (st.ui && st.ui.style.display === 'none') {
      st.ui.style.display = '';
    }

    const countChanged = st.itemCount !== items.length;
    st.items = items;
    st.itemCount = items.length;

    const previousScroll = container.scrollTop;
    const metrics = measureWindow(items);
    if (!metrics) {
      log('could not measure posts yet');
      return;
    }

    if (countChanged || !st.windowHeight) {
      st.baseWindowHeight = metrics.windowHeight;
      st.baseItemHeights = measureItemHeights(items);
      st.windowHeight = metrics.windowHeight;
    }

    container.classList.add(CLASS.window);
    container.classList.toggle(CLASS.expanded, st.expanded);
    container.style.setProperty(VARS.height, `${Math.round(st.windowHeight)}px`);

    // If the user expands a post inline (e.g. to edit it), grow the window by
    // the same amount so the whole post stays visible.
    observeWindowHeights(container, st, items);
    watchInlineExpansion(container);
    syncWindowHeight(container);

    // Hide this topic's native View more; the bulk loader handles it.
    hideViewMoreForContainer(container);

    const latestIndex = findLatestPostIndex(items);

    // Apply sort order (normal or reversed)
    applySortOrderToContainer(container, items, isReversed);

    // Setup drag auto-scroll
    setupDragAndDrop(container);

    ensureControls(container, st);

    if (st.expanded) return;

    if (!st.centered || countChanged) {
      alignLatestPostToMiddle(container, items, latestIndex, isReversed);
      st.centered = true;
    } else if (container.scrollTop !== previousScroll) {
      // Only restore when the position actually drifted (e.g. posts
      // re-rendered).
      markProgrammaticScroll(container, 150);
      container.scrollTop = previousScroll;
    }
  }

  // --- Scroll window height follows inline post expansion ---

  function measureItemHeights(items) {
    const heights = new Map();
    for (const item of items) heights.set(item, item.getBoundingClientRect().height);
    return heights;
  }

  /**
   * Watch every post in the topic so an inline expansion can be noticed even
   * when it happens without a click we see (e.g. restored edit state).
   */
  function observeWindowHeights(container, st, items) {
    if (typeof ResizeObserver === 'undefined') return;

    if (!st.heightObserver) {
      st.heightObserver = new ResizeObserver(() => scheduleWindowHeightSync(container));
    }
    const ro = st.heightObserver;
    if (st.observedItems) {
      for (const el of st.observedItems) ro.unobserve(el);
    }
    for (const el of items) ro.observe(el);
    st.observedItems = items;
  }

  /**
   * A post expands when the user clicks it (or presses Enter). ResizeObserver
   * covers the layout change, but it is not delivered in every rendering
   * environment, so re-measure shortly after any interaction as well.
   */
  function watchInlineExpansion(container) {
    if (container._cppHeightWatch) return;
    container._cppHeightWatch = true;

    const remeasure = () => syncWindowHeight(container);
    const kick = () => {
      remeasure();
      setTimeout(remeasure, 80);
      setTimeout(remeasure, 250);
      setTimeout(remeasure, 600);
    };

    container.addEventListener('click', kick, true);
    container.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Enter' || e.key === ' ') kick();
      },
      true
    );
  }

  function scheduleWindowHeightSync(container) {
    const st = stateByContainer.get(container);
    if (!st || st.heightSyncScheduled) return;
    st.heightSyncScheduled = true;
    const run = () => syncWindowHeight(container);
    requestAnimationFrame(run);
    setTimeout(run, 60);
  }

  function syncWindowHeight(container) {
    const st = stateByContainer.get(container);
    if (!st) return;
    st.heightSyncScheduled = false;
    if (st.expanded || !st.items || !st.windowHeight || !st.baseItemHeights || !st.baseWindowHeight) {
      return;
    }

    // Grow by however much the posts currently exceed their natural height,
    // so an expanded post is fully visible and a collapsed one gives the
    // space back.
    let growth = 0;
    for (const [item, height] of measureItemHeights(st.items)) {
      const base = st.baseItemHeights.get(item);
      if (typeof base === 'number' && height > base + 0.5) growth += height - base;
    }

    const target = st.baseWindowHeight + growth;
    if (Math.abs(target - st.windowHeight) < 0.5) return;

    st.windowHeight = target;
    container.style.setProperty(VARS.height, `${Math.round(target)}px`);
  }

  // --- Drag & Drop Enhancements ---

  let isDragging = false;
  let potentialDrag = null;
  let activeDragScrollSpeed = 0;
  let activeDragScrollTimer = null;
  let activeScrollWindow = null;
  let windowScrollSpeed = 0;

  function startCombinedAutoScroll() {
    if (!activeDragScrollTimer) {
      const step = () => {
        if (isDragging && (activeDragScrollSpeed !== 0 || windowScrollSpeed !== 0)) {
          if (activeScrollWindow && activeDragScrollSpeed !== 0) {
            activeScrollWindow.scrollTop += activeDragScrollSpeed;
          }
          if (windowScrollSpeed !== 0) {
            window.scrollBy(0, windowScrollSpeed);
          }
          activeDragScrollTimer = requestAnimationFrame(step);
        } else {
          stopDragAutoScroll();
        }
      };
      activeDragScrollTimer = requestAnimationFrame(step);
    }
  }

  function stopDragAutoScroll() {
    if (activeDragScrollTimer) {
      cancelAnimationFrame(activeDragScrollTimer);
      activeDragScrollTimer = null;
    }
    activeScrollWindow = null;
    activeDragScrollSpeed = 0;
    windowScrollSpeed = 0;
  }

  function handleDragAutoScroll(x, y) {
    // 1. Viewport top / bottom page-level scrolling (so user can drag across topics)
    const vpHeight = window.innerHeight;
    const vpTopZone = 60;
    const vpBottomZone = vpHeight - 60;

    let pageSpeed = 0;
    if (y < vpTopZone && y >= 0) {
      pageSpeed = -Math.round(Math.max(5, (vpTopZone - y) / 3));
    } else if (y > vpBottomZone && y <= vpHeight) {
      pageSpeed = Math.round(Math.max(5, (y - vpBottomZone) / 3));
    }

    // 2. Check if cursor is over any topic scroll window
    let hoveredWindow = null;
    const scrollWindows = document.querySelectorAll(`.${CLASS.window}`);
    for (const win of scrollWindows) {
      const rect = win.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        hoveredWindow = win;
        break;
      }
    }

    let topicSpeed = 0;
    if (hoveredWindow) {
      const r = hoveredWindow.getBoundingClientRect();
      const topZone = r.top + 50;
      const bottomZone = r.bottom - 50;

      if (y < topZone) {
        const intensity = Math.max(0.2, (topZone - y) / 50);
        topicSpeed = -Math.round(intensity * 18);
      } else if (y > bottomZone) {
        const intensity = Math.max(0.2, (y - bottomZone) / 50);
        topicSpeed = Math.round(intensity * 18);
      }
    }

    if (pageSpeed !== 0 || topicSpeed !== 0) {
      activeDragScrollSpeed = topicSpeed;
      activeScrollWindow = hoveredWindow;
      windowScrollSpeed = pageSpeed;
      startCombinedAutoScroll();
    } else {
      stopDragAutoScroll();
    }
  }

  function setupGlobalDragHandlers() {
    if (window._cppGlobalDragAttached) return;
    window._cppGlobalDragAttached = true;

    // Track mousedown on post cards or drag handles (Google Classroom uses mousedown:RlITDf on div.jWCzBe)
    document.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return;
        const target = e.target;
        // Do not block post card itself (Google Classroom assigns role="button" to post rows)
        if (target.closest('button, a, input, textarea, select, [role="menuitem"], .cpp-ui, [data-is-tooltip-wrapper="true"]')) {
          return;
        }

        const item = target.closest('li[data-stream-item-id], [data-stream-item-id], li.tfGBod, [role="listitem"]');
        if (item) {
          potentialDrag = {
            startX: e.clientX,
            startY: e.clientY,
            item,
          };
        }
      },
      true
    );

    document.addEventListener(
      'mousemove',
      (e) => {
        if (!potentialDrag) return;

        if (!isDragging) {
          const dx = e.clientX - potentialDrag.startX;
          const dy = e.clientY - potentialDrag.startY;
          if (Math.hypot(dx, dy) > 5) {
            isDragging = true;
            document.body.classList.add('cpp-dragging-active');
            log('Post drag started');
          }
        }

        if (isDragging) {
          handleDragAutoScroll(e.clientX, e.clientY);
        }
      },
      true
    );

    const finishDrag = () => {
      if (!potentialDrag && !isDragging) return;
      potentialDrag = null;

      if (isDragging) {
        log('Post drag ended');
        stopDragAutoScroll();

        // Let Google Classroom's drop handler and DOM mutation settle before re-scanning
        setTimeout(() => {
          isDragging = false;
          document.body.classList.remove('cpp-dragging-active');
          scheduleScan(80);
        }, 300);
      }
    };

    document.addEventListener('mouseup', finishDrag, true);
    document.addEventListener('pointerup', finishDrag, true);
    document.addEventListener('dragend', finishDrag, true);
  }

  function setupDragAndDrop(container) {
    if (container._cppDragAttached) return;
    container._cppDragAttached = true;

    // Standard HTML5 drag support (fallback/fixtures)
    container.addEventListener('dragover', (e) => {
      const rect = container.getBoundingClientRect();
      const y = e.clientY;
      const topZone = rect.top + 55;
      const bottomZone = rect.bottom - 55;

      if (y < topZone) {
        const intensity = Math.max(0.2, (topZone - y) / 55);
        activeDragScrollSpeed = -Math.round(intensity * 18);
        activeScrollWindow = container;
        startCombinedAutoScroll();
      } else if (y > bottomZone) {
        const intensity = Math.max(0.2, (y - bottomZone) / 55);
        activeDragScrollSpeed = Math.round(intensity * 18);
        activeScrollWindow = container;
        startCombinedAutoScroll();
      } else {
        stopDragAutoScroll();
      }
    });

    container.addEventListener('dragleave', (e) => {
      if (!container.contains(e.relatedTarget)) {
        stopDragAutoScroll();
      }
    });

    container.addEventListener('drop', () => {
      stopDragAutoScroll();
    });
  }

  // --- Sort Order (Reverse All Topics) ---

  // Looking for "Collapse all" walks every button on the page, so the result is
  // cached for a few seconds per view instead of on every scan.
  let collapseBtnCache = null;
  let collapseBtnCacheAt = 0;
  let collapseBtnCachePath = '';

  function findCollapseAllButton() {
    const now = Date.now();
    if (
      collapseBtnCache &&
      collapseBtnCache.isConnected &&
      collapseBtnCachePath === location.pathname &&
      now - collapseBtnCacheAt < 5000
    ) {
      return collapseBtnCache;
    }
    const found = findCollapseAllButtonUncached();
    collapseBtnCache = found;
    collapseBtnCacheAt = now;
    collapseBtnCachePath = location.pathname;
    return found;
  }

  function findCollapseAllButtonUncached() {
    const allBtns = document.querySelectorAll('button, [role="button"]');
    for (const btn of allBtns) {
      if (btn.id === 'cpp-sort-toggle' || btn.closest(`.${CLASS.ui}`)) continue;
      const label = (btn.getAttribute('aria-label') || '').toLowerCase();
      const text = (btn.textContent || '').toLowerCase();
      if (
        label.includes('collapse all') || label.includes('expand all') ||
        text.includes('collapse all') || text.includes('expand all') ||
        text.includes('tout réduire') || text.includes('tout développer')
      ) {
        return btn;
      }
    }

    // Fallback: look near the first topic heading/section
    const main = getMainElement();
    const firstTopic = main.querySelector('[data-topic-id], section, h2');
    if (firstTopic && firstTopic.parentElement) {
      const candidateBtn = firstTopic.parentElement.querySelector('button');
      if (candidateBtn && candidateBtn.id !== 'cpp-sort-toggle') return candidateBtn;
    }

    return null;
  }

  /** Style properties mirrored from Google's "Collapse all" button. */
  const MIRRORED_STYLE_PROPS = [
    'alignItems', 'backgroundImage', 'backgroundColor', 'borderBottomColor',
    'borderBottomLeftRadius', 'borderBottomRightRadius', 'borderBottomStyle',
    'borderBottomWidth', 'borderLeftColor', 'borderLeftStyle', 'borderLeftWidth',
    'borderRightColor', 'borderRightStyle', 'borderRightWidth', 'borderTopColor',
    'borderTopLeftRadius', 'borderTopRightRadius', 'borderTopStyle', 'borderTopWidth',
    'boxSizing', 'boxShadow', 'color', 'fontFamily', 'fontSize',
    'fontWeight', 'gap', 'height', 'justifyContent', 'letterSpacing', 'lineHeight',
    'maxHeight', 'minHeight', 'minWidth', 'paddingBottom', 'paddingLeft',
    'paddingRight', 'paddingTop', 'textTransform', 'verticalAlign', 'whiteSpace',
  ];

  /**
   * Copy the look of Classroom's own "Collapse all" button onto our button so
   * the two controls form one consistent pair (only the label differs).
   */
  function styleSortButtonLike(btn, source, active) {
    try {
      const cs = getComputedStyle(source);
      // Nothing useful to copy from a hidden button.
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      for (const prop of MIRRORED_STYLE_PROPS) {
        const value = cs[prop];
        if (value) btn.style[prop] = value;
      }
      if (cs.display) btn.style.display = cs.display;
      // Sits to the left of "Collapse all" with the same gap it uses itself.
      btn.style.marginRight = '8px';
      btn.style.marginLeft = '0px';
      btn.style.cursor = 'pointer';
      if (active) {
        btn.style.backgroundColor = 'rgba(11, 87, 208, 0.12)';
        btn.style.borderColor = '#0b57d0';
        btn.style.color = '#0b57d0';
      }
    } catch (_) {
      // Computed styles are a nicety; the CSS fallback still applies.
    }
  }

  let sortButtonStyleSource = null;

  /** Re-apply the label and styling of the existing sort button. */
  function refreshSortButton() {
    const btn = document.getElementById('cpp-sort-toggle');
    if (!btn) return;
    btn.classList.toggle('cpp-sort-active', isReversed);
    const textSpan = btn.querySelector('.cpp-sort-text');
    if (textSpan) {
      textSpan.textContent = isReversed ? 'Reverse order: ON' : 'Reverse order';
    }
    if (sortButtonStyleSource && sortButtonStyleSource.isConnected) {
      styleSortButtonLike(btn, sortButtonStyleSource, isReversed);
    }
  }

  function removeSortToggleButton() {
    const btn = document.getElementById('cpp-sort-toggle');
    if (btn) btn.remove();
    // Don't keep a reference to a button from a class we have left.
    sortButtonStyleSource = null;
  }

  function ensureSortToggleButton() {
    let btn = document.getElementById('cpp-sort-toggle');

    // The button belongs to the Classwork tab only: never show it elsewhere.
    if (!onClassworkContent()) {
      removeSortToggleButton();
      return;
    }

    const collapseBtn = findCollapseAllButton();

    if (!collapseBtn) {
      return;
    }

    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'cpp-sort-toggle';
      btn.className = 'cpp-sort-toggle';
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', 'Reverse order of posts in all topics');
      btn.innerHTML = `${SORT_ICON_SVG}<span class="cpp-sort-text">${isReversed ? 'Reverse order: ON' : 'Reverse order'}</span>`;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSortOrder();
      });
    }

    // Place it immediately before "Collapse all" (its tooltip wrapper, if any).
    const insertTarget =
      collapseBtn.closest('[data-is-tooltip-wrapper="true"]') ||
      collapseBtn.closest('[data-is-touch-wrapper="true"]') ||
      collapseBtn;
    if (btn.nextElementSibling !== insertTarget) {
      insertTarget.parentNode.insertBefore(btn, insertTarget);
    }

    sortButtonStyleSource = collapseBtn;
    refreshSortButton();
  }

  function toggleSortOrder() {
    isReversed = !isReversed;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
    } catch (_) {}

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      chrome.storage.sync.set({ isReversed });
    }

    const btn = document.getElementById('cpp-sort-toggle');
    if (btn) {
      btn.classList.toggle('cpp-sort-active', isReversed);
      const textSpan = btn.querySelector('.cpp-sort-text');
      if (textSpan) {
        textSpan.textContent = isReversed ? 'Reverse order: ON' : 'Reverse order';
      }
    }

    applySortOrderToAll();
  }

  function applySortOrderToAll() {
    for (const container of activeContainers) {
      const st = stateByContainer.get(container);
      if (!st || !st.items) continue;

      applySortOrderToContainer(container, st.items, isReversed);

      if (!st.expanded) {
        const latestIdx = findLatestPostIndex(st.items);
        alignLatestPostToMiddle(container, st.items, latestIdx, isReversed);
      }
    }
  }

  function applySortOrderToContainer(container, items, reversed) {
    container.classList.toggle('cpp-reversed', reversed);
    const count = items.length;
    for (let i = 0; i < count; i++) {
      if (reversed) {
        items[i].style.order = String(count - 1 - i);
      } else {
        items[i].style.removeProperty('order');
      }
    }
  }

  function recenterAllTopics(force) {
    for (const container of activeContainers) {
      const st = stateByContainer.get(container);
      if (!st || !st.items || st.expanded) continue;
      if (!force && st.centered) continue;
      const latestIdx = findLatestPostIndex(st.items);
      alignLatestPostToMiddle(container, st.items, latestIdx, isReversed);
      st.centered = true;
    }
  }

  const expansionAttemptsByTopic = new Map();
  // Maximum View more clicks per topic. Google loads ~10 posts per click.
  // A topic with 50+ posts needs 4+ clicks. Set high enough to cover any real classroom.
  const MAX_EXPANSION_ATTEMPTS = 30;

  /**
   * Inject CSS to hide the native "View more" button for topics we manage.
   * Buttons are only hidden after we add `.cpp-native-view-more`, so topics
   * that have not been enhanced keep Google's normal button.
   */
  function injectViewMoreHidingCSS() {
    if (viewMoreCssInjected) return;
    const style = document.createElement('style');
    style.id = 'cpp-hide-view-more';
    style.textContent = `
      /* Classroom++ — Visually hide a native "View more" button we manage */
      .cpp-native-view-more {
        position: absolute !important;
        opacity: 0 !important;
        width: 1px !important;
        height: 1px !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        clip-path: inset(50%) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    viewMoreCssInjected = true;
    log('injected CSS to hide managed View more buttons');
  }

  /**
   * Strictly verify if an element is Google Classroom's native "View more" button.
   * Must NOT match topic accordion buttons, post menus, or other Classroom buttons.
   */
  function isViewMoreButton(btn) {
    if (!btn || !btn.isConnected) return false;

    // Must not be disabled
    if (btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') {
      return false;
    }

    // Must not be inside a container that Google Classroom explicitly hid
    const hiddenAncestor = btn.closest('[style*="display: none"], [style*="display:none"], [hidden]');
    if (hiddenAncestor) {
      return false;
    }

    // Check aria-label specifically for "View more"
    const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (ariaLabel.includes('view more')) {
      return true;
    }

    // Check inner text strictly
    const text = (btn.textContent || '').trim().toLowerCase();
    if (text === 'view more' || text.includes('view more posts') || text === 'afficher plus' || text === 'ver más') {
      return true;
    }

    // Check Google Classroom's topic overflow jsname="t6Kl7b"
    if (btn.getAttribute('jsname') === 't6Kl7b') {
      if (!ariaLabel || ariaLabel.includes('more') || text.includes('more')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Safely dispatch click event to trigger Google Wiz/Closure actions without stealing focus.
   * Dispatches a full pointer event sequence (pointerdown → pointerup → click) because
   * Google's WIZ jsaction listens for pointerdown:FEiYhc and pointerup:mF5Elf in addition
   * to click:h5M12e. Using only .click() may miss the pointer handlers on slow-loading pages.
   */
  function triggerClick(el) {
    if (!el) return;
    try {
      const opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
    } catch (_) {
      // Fallback to the native .click() if PointerEvent isn't supported
      try { el.click(); } catch (_2) {}
    }
  }

  /**
   * Find any genuine "View more" buttons that haven't been clicked yet.
   */
  function findUnclickedViewMore() {
    const results = [];
    const seen = new Set();

    const selectors = [
      'button[aria-label*="View more" i]',
      '[role="button"][aria-label*="View more" i]',
      'button[jsname="t6Kl7b"]',
      '[role="button"][jsname="t6Kl7b"]',
    ];
    const candidates = document.querySelectorAll(selectors.join(', '));
    for (const el of candidates) {
      const btn = el.closest('button, [role="button"]') || el;
      if (!seen.has(btn) && !btn.dataset.cppClicked && isViewMoreButton(btn)) {
        const topicNode = btn.closest('[data-topic-id]');
        const topicId = topicNode ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') : 'unknown';
        const attempts = expansionAttemptsByTopic.get(topicId) || 0;
        if (attempts < MAX_EXPANSION_ATTEMPTS) {
          seen.add(btn);
          results.push(btn);
        }
      }
    }

    // Also check other buttons strictly for "View more" text
    const allButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of allButtons) {
      if (!seen.has(btn) && !btn.dataset.cppClicked && isViewMoreButton(btn)) {
        const topicNode = btn.closest('[data-topic-id]');
        const topicId = topicNode ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') : 'unknown';
        const attempts = expansionAttemptsByTopic.get(topicId) || 0;
        if (attempts < MAX_EXPANSION_ATTEMPTS) {
          seen.add(btn);
          results.push(btn);
        }
      }
    }

    return results;
  }

  /**
   * Find the topic section that owns a post-list container.
   */
  function topicNodeForContainer(container) {
    return (
      container.closest('[data-topic-id]') ||
      container.closest('section, [role="region"], [aria-label*="Topic" i]') ||
      container.parentElement
    );
  }

  function topicIdForNode(node) {
    const topicNode = node && node.closest ? node.closest('[data-topic-id]') : null;
    return topicNode
      ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') || 'unknown'
      : 'unknown';
  }

  /**
   * Find the native "View more" button belonging to one topic only.
   */
  function findViewMoreForContainer(container) {
    const topicNode = topicNodeForContainer(container);
    if (!topicNode) return null;

    for (const btn of topicNode.querySelectorAll('button, [role="button"]')) {
      if (btn.dataset.cppClicked || !isViewMoreButton(btn)) continue;
      const attempts = expansionAttemptsByTopic.get(topicIdForNode(btn)) || 0;
      if (attempts < MAX_EXPANSION_ATTEMPTS) return btn;
    }
    return null;
  }

  /**
   * Hide the native button for an enhanced topic (our scroll window takes over).
   */
  function hideViewMoreForContainer(container) {
    const topicNode = topicNodeForContainer(container);
    if (!topicNode) return;
    for (const btn of topicNode.querySelectorAll('button, [role="button"]')) {
      if (btn.dataset.cppClicked || isViewMoreButton(btn)) {
        btn.classList.add('cpp-native-view-more');
      }
    }
  }

  /**
   * Count the posts Classroom++ actually sees: the list items of the topic post
   * lists inside the Classwork main area. Uses the same grouping as the scanner,
   * so menus and the To-do sidebar are not counted as posts.
   */
  function countLoadedPosts() {
    const main = getMainElement();
    // Count each post once. Two things used to inflate this number:
    //   - overlapping groups (a wrapper list and the topic list inside it both
    //     contributed the same posts), and
    //   - the previous class' topic lists, which Classroom leaves in the DOM
    //     (hidden) while switching classes, so a second load added the first
    //     class' posts to the total.
    const counted = new Set();
    for (const [container, items] of collectGroups(main)) {
      if (!container.getClientRects().length) continue;
      for (const item of items) counted.add(item);
    }
    return counted.size;
  }

  /**
   * Cheap counter used only to notice that a "View more" click appended posts.
   * Includes role="listitem" so fixtures and pages that don't expose
   * data-stream-item-id still report progress.
   */
  function currentPostCount() {
    const main = getMainElement();
    return main.querySelectorAll('[data-stream-item-id], [role="listitem"]').length;
  }

  /**
   * Wait until a View more click actually adds posts. Resolves immediately on
   * the DOM mutation that appends the response and removes the clicked buttons,
   * instead of always sleeping for a fixed 500 ms. When Google leaves a button
   * connected, a short settle delay still protects parallel batch responses.
   */
  function waitForExpansionProgress(previousCount, clickedButtons) {
    return new Promise((resolve) => {
      let settled = false;
      let sawProgress = false;
      let settleTimer = 0;

      const finish = () => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeout);
        clearTimeout(settleTimer);
        resolve();
      };

      const check = () => {
        if (settled) return;

        if (currentPostCount() > previousCount) sawProgress = true;

        const allButtonsDone = clickedButtons.every((btn) => !btn.isConnected);
        if (sawProgress && allButtonsDone) {
          finish();
          return;
        }

        // Some responses may arrive a little later than the first one. Give
        // them a short grace period when the button remains in the DOM.
        if (sawProgress) {
          clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, 500);
        }
      };

      const observer = new MutationObserver(check);
      const timeout = setTimeout(finish, EXPANSION_WAIT_TIMEOUT);
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
      check();
    });
  }

  /**
   * Mark programmatic scroll changes so they don't look like the user asking
   * for more posts.
   */
  function markProgrammaticScroll(container, ms = 700) {
    container._cppIgnoreScrollUntil = Date.now() + ms;
  }

  let expansionRequested = false;
  /**
   * Expand every topic in the background whenever there is something left to
   * fetch. A no-op when everything is already loaded, which is what keeps a
   * return trip to the Classwork tab from reloading anything.
   */
  function requestExpansion(delay = 0) {
    if (isExpanding || expansionRequested) return;
    if (!classworkLayoutEnabled) return;
    if (!onClassworkContent()) return;
    if (findUnclickedViewMore().length === 0) return;

    expansionRequested = true;
    window.setTimeout(() => {
      expansionRequested = false;
      triggerAutoExpansion();
    }, delay);
  }

  /**
   * Safety net for a Classwork view that appears without a mutation our
   * observer can see (switching classes reuses the previous class' DOM and new
   * topics can be revealed by style/attribute changes only). Without this, a
   * half-loaded topic stayed that way until the page was reloaded.
   */
  function ensurePostsLoaded() {
    if (document.visibilityState === 'hidden') return;
    if (isExpanding || expansionRequested) return;
    if (!classworkLayoutEnabled) return;
    if (!onClassworkContent()) return;
    if (findUnclickedViewMore().length === 0) return;
    requestExpansion(0);
  }

  /**
   * Cheap snapshot of what Classwork is currently showing. Classroom can put a
   * whole page on screen by revealing already-rendered nodes (style/attribute
   * changes) rather than by adding nodes, which the MutationObserver never
   * reports — that is why entering a class sometimes did nothing until a
   * reload. The poll below compares this snapshot and rescans on any change.
   */
  function viewSignature() {
    const topics = Array.from(document.querySelectorAll('[data-topic-id]'));
    let visibleTopics = 0;
    let firstVisibleId = '';
    for (const topic of topics) {
      if (!topic.getClientRects().length) continue;
      visibleTopics++;
      if (!firstVisibleId) firstVisibleId = topic.getAttribute('data-topic-id') || '';
    }
    return [
      location.pathname,
      topics.length,
      visibleTopics,
      // Topic ids differ per class, so switching between two classes with the
      // same number of topics still counts as a change.
      firstVisibleId,
    ].join('|');
  }

  let lastViewSignature = '';
  let pollTimer = 0;

  /** Timer-driven fallback for views the observer cannot see. */
  function pollView() {
    // Nothing here matters while the tab is in the background; resuming the tab
    // fires visibilitychange, which scans immediately.
    if (document.visibilityState === 'hidden') return;
    if (!classworkLayoutEnabled) return;

    // Silent SPA navigation (history.pushState) fires no event of its own.
    if (location.pathname !== lastPath) onNavigationChange();

    const signature = viewSignature();
    const changed = signature !== lastViewSignature;
    // Also retry while Classwork is showing but nothing has been enhanced yet,
    // in case the first scan ran before the page was ready.
    const stuck =
      activeContainers.size === 0 &&
      onClassworkContent() &&
      document.querySelectorAll('[data-topic-id]').length > 0 &&
      Date.now() - lastScanAt > 1500;

    if (changed) lastViewSignature = signature;
    if (changed || stuck) scheduleScan(0);

    ensurePostsLoaded();
  }

  /**
   * Load every post of every topic by clicking Google's native "View more"
   * until nothing is truncated, then apply the 5-post windows.
   */
  async function triggerAutoExpansion() {
    if (isExpanding) return;

    const initial = findUnclickedViewMore();
    if (initial.length === 0) return;

    // Only the Classwork tab has posts to load, so only it gets the progress bar.
    const showProgress = onClassworkContent();
    if (showProgress) beginSetup();
    isExpanding = true;
    injectViewMoreHidingCSS();

    try {
      // Click all currently-visible View more buttons. More rounds may be triggered
      // reactively by the MutationObserver as XHR responses arrive and new buttons appear.
      for (let round = 0; round < 20; round++) {
        // The user may navigate to another tab mid-load; stop fetching there.
        if (!onClassworkContent()) break;

        const buttons = findUnclickedViewMore();
        if (buttons.length === 0) break;

        log(`expanding ${buttons.length} native View more button(s) (round ${round + 1})`);

        const countBefore = currentPostCount();
        updateOverlay();

        for (const btn of buttons) {
          btn.dataset.cppClicked = 'true';
          btn.classList.add('cpp-native-view-more');
          const topicNode = btn.closest('[data-topic-id]');
          const topicId = topicNode ? topicNode.dataset.topicId || topicNode.getAttribute('data-topic-id') : 'unknown';
          const attempts = expansionAttemptsByTopic.get(topicId) || 0;
          // Bounded so a long-lived tab can never accumulate topic ids.
          if (expansionAttemptsByTopic.size > 500) expansionAttemptsByTopic.clear();
          expansionAttemptsByTopic.set(topicId, attempts + 1);

          triggerClick(btn);
        }

        // Resolve as soon as the XHR response appends posts instead of waiting
        // a fixed 500 ms for every batch.
        await waitForExpansionProgress(countBefore, buttons);
        noteSetupActivity();
      }
    } catch (err) {
      console.error('[Classroom++] auto expansion error:', err);
    } finally {
      isExpanding = false;
      noteSetupActivity();

      // Apply the 5-post window, sort order and latest-post alignment now that
      // every post is present. This replaces the old 50 ms + 300 ms delays.
      if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = 0;
      }
      scan();
      recenterAllTopics(true);

      // Restore scroll to top — loading caused the page to jump down
      if (window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: 'instant' });
      }
      noteSetupActivity();
    }
  }

  function scan() {
    // Don't rearrange while posts are still being appended; triggerAutoExpansion
    // runs a final scan once every View more batch has arrived.
    if (isDragging || isExpanding || scan._running) return;
    scan._running = true;
    try {
      // A different page or class is a fresh start: clear the per-topic click
      // budget so a topic that had hit the cap gets loaded after all (this is
      // what made switching classes sometimes need a full reload).
      if (location.pathname !== lastScanPath) {
        lastScanPath = location.pathname;
        expansionAttemptsByTopic.clear();
      }

      // The "To review" page has its own enhancement; its rows are not topic
      // posts and must never be turned into a 5-post scroll window.
      updateReviewMode();
      if (isToReviewView()) {
        for (const container of Array.from(activeContainers)) teardown(container);
        removeSortToggleButton();
        return;
      }

      // Classwork Layout switched off in the popup: leave the Classwork page
      // exactly as Google built it, and undo anything already applied.
      if (!classworkLayoutEnabled) {
        for (const container of Array.from(activeContainers)) teardown(container);
        removeSortToggleButton();
        cancelSetup();
        return;
      }

      // Not the Classwork view: leave the page exactly as Classroom rendered it
      // (no wrapping, no hidden buttons, no overlay). Anything we added on a
      // previous view is undone — but only once the topic nodes are really gone.
      // While Classroom re-renders a class, or keeps another class' view parked
      // in the DOM, tearing down would strip a view we are about to reuse, so we
      // simply do nothing and let the next scan finish the job.
      if (!onClassworkContent()) {
        // The Reverse order button lives in the global toolbar, outside the
        // parked view, so it always goes away here.
        removeSortToggleButton();
        // A different view means these per-topic counters are no longer useful.
        expansionAttemptsByTopic.clear();
        const parkedTopics = document.querySelector('[data-topic-id]');
        if (!parkedTopics && !isExpanding) {
          for (const container of Array.from(activeContainers)) teardown(container);
          cancelSetup();
        }
        return;
      }

      ensureSortToggleButton();

      const main = getMainElement();
      const groups = collectGroups(main);

      for (const [container, items] of groups) {
        if (!shouldHandle(container, items)) {
          if (activeContainers.has(container)) teardown(container);
          continue;
        }
        activeContainers.add(container);
        applyWindow(container, items);
      }

      for (const container of Array.from(activeContainers)) {
        if (!groups.has(container) || !container.isConnected) teardown(container);
      }

      reportScan(groups);
    } catch (err) {
      console.error('[Classroom++] scan failed', err);
    } finally {
      scan._running = false;
      lastScanAt = Date.now();
      // No noteSetupActivity() here: routine scans (SPA mutations, re-renders)
      // must not keep the global overlay alive. Only actual loading shows it.

      // A topic may have appeared with posts still behind "View more" (new
      // topic, new post, return trip). Finish loading it in the background.
      if (!isExpanding && isClassworkView() && findUnclickedViewMore().length > 0) {
        requestExpansion(60);
      }
    }
  }

  let lastScanPath = location.pathname;

  let lastReport = '';
  function reportScan(groups) {
    const summary = `enhanced=${activeContainers.size} groups=${groups.size} path=${location.pathname}`;
    if (summary !== lastReport) {
      lastReport = summary;
      console.info(`[Classroom++] active (${extensionVersion()}): ${summary}`);
    }
  }

  function extensionVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return '?';
    }
  }

  /**
   * Reset all enhanced topics to default:
   * Collapsed (5 posts visible) and re-aligned with latest post in the middle.
   */
  function resetAllToDefault() {
    for (const container of activeContainers) {
      const st = stateByContainer.get(container);
      if (st) {
        st.expanded = false;
        st.centered = false;
        container.classList.remove(CLASS.expanded);
      }
    }
  }

  /**
   * A Classwork route (/c/<id>/t/all, /w/<id>/t/<topicId>) or a query that
   * names the Classwork view. Archived classes render the same tab with
   * different chrome, so the route is the most reliable signal.
   */
  function isClassworkPath() {
    return (
      /\/t\/(?:all|[^/]+)\/?$/i.test(location.pathname) ||
      /[?&]tab=classwork\b/i.test(location.search)
    );
  }

  /**
   * Check if current page is within the Classwork section.
   *
   * Only the Classwork tab may be enhanced. Its topic sections are the only
   * place Classroom++ has anything to do; the class Stream, Home, Calendar,
   * People and the To-do page share the same URL prefix for a class, so a class
   * page is never treated as Classwork just because of its path.
   */
  function isClassworkView() {
    // A visible topic list means the Classwork view is the one on screen.
    const topicNode = document.querySelector('[data-topic-id]');
    if (topicNode && topicNode.getClientRects().length > 0) return true;

    // A classwork route or a title that names the Classwork view is
    // authoritative. Archived classes render the same tab with different
    // chrome — their tab strip is missing or does not expose the selected tab —
    // and requiring those signals made the extension skip every archived class
    // entirely.
    if (isClassworkPath()) return true;
    if (/(?:^|[-–—|·:]\s*)classwork\s*$/i.test(document.title || '')) return true;

    // Classroom's own navigation, because a class' Stream page shares the class
    // URL prefix with its Classwork tab.
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"]');
    if (activeTab) return /classwork/i.test(activeTab.textContent || '');
    const currentLink = document.querySelector('a[aria-current="page"]');
    if (currentLink) return /classwork/i.test(currentLink.textContent || '');

    // Topic nodes exist but are hidden, with no other signal: another tab is
    // showing, so there is nothing to load (and no progress bar).
    return false;
  }

  /** Does any topic section currently have a visible box on screen? */
  function hasVisibleTopics() {
    for (const topic of document.querySelectorAll('[data-topic-id]')) {
      if (topic.getClientRects().length) return true;
    }
    return false;
  }

  /**
   * Are we looking at something Classroom++ should enhance?
   *
   * Visible topic sections are unambiguous — no other Classroom view (Home,
   * Stream, Calendar, People, To-do) renders topics — so they decide on their
   * own, no URL or tab-name guessing. That is what makes every class behave the
   * same, whatever the route looks like.
   */
  function onClassworkContent() {
    return hasVisibleTopics() || isClassworkView();
  }

  /**
   * A full page load already has fresh posts, so record the class as loaded
   * before the user navigates away from it.
   */
  function rememberCurrentClassOnLoad() {
    if (isToReviewView()) return;
    if (!isClassworkPath() && !isClassworkView()) return;
    const classId = currentClassId();
    if (classId) rememberLoadedClass(classId);
  }

  /**
   * Classwork is a single-page view: Classroom reuses the posts already on the
   * page, so a class visited earlier in this tab would never fetch new posts.
   * Force one full reload the first time each class is entered in this tab.
   * The class is recorded before reloading so the reloaded page does not loop.
   */
  function reloadOnceForFreshPosts() {
    if (!classworkLayoutEnabled) return false;
    if (isToReviewView()) return false;
    if (!isClassworkView()) return false;

    const classId = currentClassId();
    if (!classId || hasLoadedClass(classId)) return false;

    rememberLoadedClass(classId);
    log(`entering class ${classId}: reloading for fresh posts`);
    location.reload();
    return true;
  }

  let lastPath = location.pathname;
  let lastWasClasswork = isClassworkView();

  function onNavigationChange() {
    const currentPath = location.pathname;
    const currentIsClasswork = isClassworkView();

    // When the user enters Classwork, or exits and comes back:
    if (currentIsClasswork && (!lastWasClasswork || currentPath !== lastPath)) {
      // A class entering Classwork for the first time in this tab gets a fresh
      // page load; revisiting it reuses the posts already on the page.
      if (reloadOnceForFreshPosts()) {
        lastPath = currentPath;
        lastWasClasswork = currentIsClasswork;
        return;
      }
      resetAllToDefault();
      scheduleScan(100);
      // Only loads (and only shows the bar) if something is still behind
      // "View more"; posts already on the page are reused as-is.
      requestExpansion(0);
    } else if (!currentIsClasswork && lastWasClasswork) {
      cancelSetup();
    }

    lastPath = currentPath;
    lastWasClasswork = currentIsClasswork;
    updateReviewMode();
    scheduleScan(100);
  }

  let scanTimer = 0;
  let lastScanAt = 0;
  function scheduleScan(customWait) {
    if (scanTimer) return;
    const wait = customWait || Math.max(100, 300 - (Date.now() - lastScanAt));
    scanTimer = window.setTimeout(() => {
      scanTimer = 0;
      scan();
    }, wait);
  }

  function isOurNode(node) {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!el || !el.classList || !el.classList.contains) return false;
    return (
      el.classList.contains(CLASS.ui) ||
      el.classList.contains('cpp-loading-overlay') ||
      el.id === 'cpp-sort-toggle' ||
      el.closest(`.${CLASS.ui}`) !== null ||
      el.closest('.cpp-loading-overlay') !== null
    );
  }

  const observer = new MutationObserver((records) => {
    // Ignore DOM mutations while the user is actively dragging posts
    if (isDragging) return;

    let hasRelevantChanges = false;

    for (const record of records) {
      if (record.type !== 'childList') continue;
      const addedNodes = Array.from(record.addedNodes);
      const allNodes = addedNodes.concat(Array.from(record.removedNodes));
      if (!allNodes.length) continue;
      if (allNodes.every(isOurNode)) continue;

      hasRelevantChanges = true;
    }

    if (!hasRelevantChanges) return;

    // New topics are enhanced silently. The scan itself starts a background
    // load only when a topic is actually truncated, so ordinary SPA mutations
    // never resurrect the loading bar.
    scheduleScan(120);
  });

  function diagnose() {
    const main = getMainElement();
    let groups = new Map();
    try {
      groups = collectGroups(main);
    } catch (err) {
      return { error: String(err) };
    }
    return {
      url: location.href,
      extensionVersion: extensionVersion(),
      isClassworkView: isClassworkView(),
      onClassworkContent: onClassworkContent(),
      visibleTopics: hasVisibleTopics(),
      title: document.title,
      topicsCount: document.querySelectorAll('[data-topic-id]').length,
      streamItemsCount: document.querySelectorAll('[data-stream-item-id]').length,
      roleMainFound: !!document.querySelector(MAIN_SELECTOR),
      h2Headings: main.querySelectorAll('h2').length,
      groups: Array.from(groups.entries()).map(([container, items]) => {
        const latestIdx = findLatestPostIndex(items);
        return {
          itemsCount: items.length,
          handled: shouldHandle(container, items),
          latestPostIndex: latestIdx,
          latestIsDraft: latestIdx >= 0 ? isDraftItem(items[latestIdx]) : false,
          hidden: container.getBoundingClientRect().width === 0,
        };
      }),
      enhanced: activeContainers.size,
    };
  }

  // ── To review: bulk "Mark as reviewed" ──────────────────────────────────

  const REVIEW_PATH_RE = /^\/(?:u\/\d+\/)?ta\/not-reviewed/;
  const REVIEW_ROW_SELECTOR = 'li[data-role="task-row"]';
  const REVIEW_MARK_LABEL_RE = /^mark as reviewed\b/i;

  let reviewActive = false;
  let reviewObserver = null;
  let reviewSyncTimer = 0;
  let reviewBar = null;
  let reviewBusy = false;
  let reviewMessage = '';
  let reviewMessageTimer = 0;
  let reviewAnchor = null; // last row toggled on its own, for shift-ranges
  const reviewSelected = new Set();

  /**
   * On the "To review" page each assignment is marked reviewed one at a time
   * through its "Assignment options" menu. This mode adds a checkbox per row
   * and a bar that marks every selected row in one go.
   */
  function isToReviewView() {
    if (REVIEW_PATH_RE.test(location.pathname)) return true;
    // Also covers fixtures and any rendered To review list regardless of URL.
    const row = document.querySelector(REVIEW_ROW_SELECTOR);
    return !!(row && row.getClientRects().length > 0);
  }

  function reviewRows() {
    return Array.from(document.querySelectorAll(REVIEW_ROW_SELECTOR));
  }

  function reviewMenuItemLabel(el) {
    return (el.getAttribute('aria-label') || el.textContent || '').trim();
  }

  /** Only rows whose options menu can mark the assignment reviewed. */
  function rowSupportsBulkReview(row) {
    const items = row.querySelectorAll('[role="menuitem"]');
    if (items.length) {
      return Array.from(items).some((item) => REVIEW_MARK_LABEL_RE.test(reviewMenuItemLabel(item)));
    }
    // Menus are rendered lazily on some Classroom versions.
    return !!row.querySelector(
      'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label*="options" i]'
    );
  }

  function reviewRowTitle(row) {
    const titleEl = row.querySelector('.YH8M6e, a[href*="/submissions/"] p, a[href*="/a/"] p');
    const text = titleEl && titleEl.textContent.trim();
    if (text) return text;
    const trigger = row.querySelector('button[aria-label*="options" i]');
    return ((trigger && trigger.getAttribute('aria-label')) || '')
      .replace(/^.*?options for\s*/i, '')
      .trim();
  }

  /** Markable rows in document order, i.e. the rows a shift-range can span. */
  function reviewRangeRows() {
    return reviewRows().filter((row) => !!row.querySelector('.cpp-review-box'));
  }

  /** Every row between two rows inclusive, or null if either is no longer listed. */
  function reviewRangeBetween(from, to) {
    const rows = reviewRangeRows();
    const a = rows.indexOf(from);
    const b = rows.indexOf(to);
    if (a < 0 || b < 0) return null;
    return rows.slice(Math.min(a, b), Math.max(a, b) + 1);
  }

  function setRowSelected(row, checked) {
    const box = row.querySelector('.cpp-review-box');
    if (box && box.checked !== checked) box.checked = checked;
    if (checked) reviewSelected.add(row);
    else reviewSelected.delete(row);
  }

  /**
   * A plain click selects one row and becomes the anchor. Shift-click selects
   * everything from the anchor to the clicked row, all in the clicked box's new
   * state, so a shift-click on a checked row clears the whole span.
   */
  function onReviewBoxClick(row, box, event) {
    if (reviewBusy) {
      box.checked = reviewSelected.has(row);
      return;
    }
    clearReviewMessage();

    const range = event.shiftKey && reviewAnchor ? reviewRangeBetween(reviewAnchor, row) : null;
    const affected = range || [row];
    for (const target of affected) setRowSelected(target, box.checked);

    reviewAnchor = row;
    updateReviewBar();
  }

  function addReviewCheckbox(row) {
    if (row.querySelector('.cpp-review-check')) return;
    row.classList.add('cpp-review-row');

    const wrap = document.createElement('span');
    wrap.className = 'cpp-review-check';
    wrap.addEventListener('click', (e) => e.stopPropagation());

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cpp-review-box';
    box.setAttribute('aria-label', `Select ${reviewRowTitle(row) || 'assignment'} for bulk review`);
    box.title = 'Shift-click to select a range';
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      onReviewBoxClick(row, box, e);
    });

    wrap.appendChild(box);
    row.insertBefore(wrap, row.firstChild);
  }

  function ensureReviewBar() {
    if (reviewBar && reviewBar.isConnected) return reviewBar;

    const bar = document.createElement('div');
    bar.className = 'cpp-review-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Bulk review actions');

    const allLabel = document.createElement('label');
    allLabel.className = 'cpp-review-all';
    const allBox = document.createElement('input');
    allBox.type = 'checkbox';
    allBox.className = 'cpp-review-all-box';
    allBox.setAttribute('aria-label', 'Select every assignment shown');
    allBox.addEventListener('change', () => {
      clearReviewMessage();
      reviewAnchor = null;
      for (const row of reviewRows()) {
        if (!row.querySelector('.cpp-review-box')) continue;
        setRowSelected(row, allBox.checked);
      }
      updateReviewBar();
    });
    const allText = document.createElement('span');
    allText.textContent = 'Select all';
    allLabel.appendChild(allBox);
    allLabel.appendChild(allText);

    const status = document.createElement('span');
    status.className = 'cpp-review-status';
    status.setAttribute('aria-live', 'polite');

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'cpp-review-run';
    run.addEventListener('click', () => markSelectedAsReviewed());

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'cpp-review-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => clearReviewSelection());

    bar.appendChild(allLabel);
    bar.appendChild(status);
    bar.appendChild(run);
    bar.appendChild(cancel);
    document.body.appendChild(bar);
    reviewBar = bar;
    return bar;
  }

  function setReviewText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function clearReviewMessage() {
    reviewMessage = '';
    clearTimeout(reviewMessageTimer);
    reviewMessageTimer = 0;
  }

  function setReviewMessage(text, ms = 0) {
    reviewMessage = text;
    clearTimeout(reviewMessageTimer);
    reviewMessageTimer = 0;
    if (ms) {
      reviewMessageTimer = window.setTimeout(() => {
        reviewMessageTimer = 0;
        reviewMessage = '';
        updateReviewBar();
      }, ms);
    }
    updateReviewBar();
  }

  function updateReviewBar() {
    if (!reviewBar) return;

    let selected = 0;
    let selectable = 0;
    for (const row of reviewRows()) {
      const box = row.querySelector('.cpp-review-box');
      if (box) selectable++;
      const checked = reviewSelected.has(row);
      if (box && box.checked !== checked) box.checked = checked;
      if (box && box.disabled !== reviewBusy) box.disabled = reviewBusy;
      row.classList.toggle('cpp-review-selected', checked);
      if (checked) selected++;
    }

    const allBox = reviewBar.querySelector('.cpp-review-all-box');
    const status = reviewBar.querySelector('.cpp-review-status');
    const run = reviewBar.querySelector('.cpp-review-run');
    const cancel = reviewBar.querySelector('.cpp-review-cancel');

    const hide = selected === 0 && !reviewBusy;
    if (reviewBar.hidden !== hide) reviewBar.hidden = hide;

    if (allBox) {
      const allChecked = selected > 0 && selected === selectable;
      if (allBox.checked !== allChecked) allBox.checked = allChecked;
      const mixed = selected > 0 && !allChecked;
      if (allBox.indeterminate !== mixed) allBox.indeterminate = mixed;
      if (allBox.disabled !== reviewBusy) allBox.disabled = reviewBusy;
    }

    if (status) {
      const countText = selected === 1 ? '1 assignment selected' : `${selected} assignments selected`;
      setReviewText(status, reviewMessage || countText);
    }
    if (run) {
      setReviewText(run, selected === 1 ? 'Mark as reviewed' : `Mark ${selected} as reviewed`);
      const disabled = reviewBusy || selected === 0;
      if (run.disabled !== disabled) run.disabled = disabled;
    }
    if (cancel && cancel.disabled !== reviewBusy) cancel.disabled = reviewBusy;
  }

  function syncReviewRows() {
    if (!reviewActive) return;

    for (const row of reviewRows()) {
      // Skip rows that cannot be marked reviewed, and rows inside a collapsed
      // due-date group where the options menu cannot be opened.
      if (!rowSupportsBulkReview(row) || !row.getClientRects().length) {
        const existing = row.querySelector('.cpp-review-check');
        if (existing) existing.remove();
        row.classList.remove('cpp-review-row', 'cpp-review-selected');
        reviewSelected.delete(row);
        continue;
      }
      addReviewCheckbox(row);
    }

    for (const row of Array.from(reviewSelected)) {
      if (!row.isConnected) reviewSelected.delete(row);
    }
    updateReviewBar();
  }

  function scheduleReviewSync() {
    if (!reviewActive || reviewSyncTimer) return;
    reviewSyncTimer = window.setTimeout(() => {
      reviewSyncTimer = 0;
      syncReviewRows();
    }, 150);
  }

  function activateReviewMode() {
    reviewActive = true;
    document.documentElement.classList.add('cpp-review-mode');
    ensureReviewBar();
    if (!reviewObserver) {
      reviewObserver = new MutationObserver(scheduleReviewSync);
      reviewObserver.observe(document.body, { childList: true, subtree: true });
    }
    syncReviewRows();
  }

  function deactivateReviewMode() {
    if (!reviewActive && !reviewBar) return;
    reviewActive = false;
    document.documentElement.classList.remove('cpp-review-mode');
    reviewBusy = false;
    reviewMessage = '';
    clearTimeout(reviewMessageTimer);
    reviewMessageTimer = 0;
    clearTimeout(reviewSyncTimer);
    reviewSyncTimer = 0;
    if (reviewObserver) {
      reviewObserver.disconnect();
      reviewObserver = null;
    }
    reviewAnchor = null;
    reviewSelected.clear();
    for (const row of reviewRows()) {
      row.classList.remove('cpp-review-row', 'cpp-review-selected');
      const check = row.querySelector('.cpp-review-check');
      if (check) check.remove();
    }
    if (reviewBar) {
      reviewBar.remove();
      reviewBar = null;
    }
  }

  function updateReviewMode() {
    // The extra checkboxes/action bar are opt-in from the extension popup, and
    // they only ever exist on the To review tab.
    if (bulkReviewEnabled && isToReviewView()) {
      if (!reviewActive) activateReviewMode();
      else syncReviewRows();
    } else if (reviewActive) {
      deactivateReviewMode();
    }
  }

  function clearReviewSelection() {
    if (reviewBusy) return;
    clearReviewMessage();
    reviewAnchor = null;
    reviewSelected.clear();
    for (const row of reviewRows()) {
      const box = row.querySelector('.cpp-review-box');
      if (box) box.checked = false;
    }
    updateReviewBar();
  }

  function waitForCondition(condition, timeout = 2000, interval = 100) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let result = null;
        try {
          result = condition();
        } catch (_) {}
        if (result) return resolve(result);
        if (Date.now() - started >= timeout) return resolve(null);
        window.setTimeout(tick, interval);
      };
      tick();
    });
  }

  function findReviewMenuTrigger(row) {
    const buttons = Array.from(
      row.querySelectorAll(
        'button[aria-haspopup="menu"], [role="button"][aria-haspopup="menu"], button[aria-label*="options" i]'
      )
    );
    return (
      buttons.find((btn) => /options/i.test(btn.getAttribute('aria-label') || '')) ||
      buttons[0] ||
      null
    );
  }

  function findMarkReviewedItem(row) {
    const direct = Array.from(row.querySelectorAll('button, [role="button"]')).find((el) =>
      REVIEW_MARK_LABEL_RE.test((el.getAttribute('aria-label') || '').trim())
    );
    if (direct) return direct;

    const isVisible = (el) => !!el.getClientRects().length;
    const inRow = Array.from(row.querySelectorAll('[role="menuitem"]')).filter((el) =>
      REVIEW_MARK_LABEL_RE.test(reviewMenuItemLabel(el))
    );
    const visibleInRow = inRow.find(isVisible);
    if (visibleInRow) return visibleInRow;

    // Open menus can be hoisted to the end of <body> instead of staying inline.
    for (const el of document.querySelectorAll('[role="menuitem"]')) {
      if (!REVIEW_MARK_LABEL_RE.test(reviewMenuItemLabel(el))) continue;
      if (isVisible(el) && !el.closest(REVIEW_ROW_SELECTOR)) return el;
    }
    // Closed menus keep their items in the DOM; the caller opens the menu first.
    return inRow[0] || null;
  }

  /** Open a row's options menu and click its "Mark as reviewed" action. */
  async function markRowAsReviewed(row) {
    if (!row.isConnected) return false;

    let item = findMarkReviewedItem(row);
    if (!item || !item.getClientRects().length) {
      const trigger = findReviewMenuTrigger(row);
      if (trigger) {
        triggerClick(trigger);
        item = await waitForCondition(() => {
          const found = findMarkReviewedItem(row);
          return found && found.getClientRects().length ? found : null;
        }, 1500);
      }
    }
    if (!item) return false;

    triggerClick(item);

    // Classroom drops the row from "To review" once the change is recorded
    // (some versions instead swap the row's action to "Mark as not reviewed").
    const finished = await waitForCondition(
      () => !row.isConnected || !rowSupportsBulkReview(row),
      5000
    );
    return !!finished;
  }

  async function markSelectedAsReviewed() {
    if (reviewBusy) return;
    const rows = reviewRows().filter((row) => reviewSelected.has(row));
    if (rows.length === 0) return;

    reviewBusy = true;
    updateReviewBar();

    let marked = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      if (!isToReviewView()) break;
      setReviewMessage(`Marking ${i + 1} of ${rows.length}…`);
      const ok = await markRowAsReviewed(rows[i]);
      if (ok) {
        marked++;
        reviewSelected.delete(rows[i]);
      } else {
        failed++;
      }
    }

    reviewBusy = false;
    if (!reviewActive) return; // navigated away mid-run

    if (failed > 0) setReviewMessage(`${failed} of ${rows.length} could not be marked as reviewed.`, 6000);
    else setReviewMessage(`Marked ${marked} as reviewed.`, 4000);
  }

  // ── End To review bulk mode ──────────────────────────────────────────────

  function init() {
    loadInitialSettings();
    // This page load already has fresh posts; remember the class so navigating
    // away and back in this tab does not trigger another reload.
    rememberCurrentClassOnLoad();
    // Nothing is ever fetched or hidden outside the Classwork tab.
    if (isClassworkView()) injectViewMoreHidingCSS();
    setupGlobalDragHandlers();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', () => {
      // Re-measure the 5-post windows from scratch.
      for (const container of activeContainers) {
        const st = stateByContainer.get(container);
        if (!st) continue;
        st.windowHeight = 0;
        st.baseWindowHeight = 0;
        st.baseItemHeights = null;
      }
      scheduleScan();
    });
    window.addEventListener('popstate', onNavigationChange);
    window.addEventListener('hashchange', onNavigationChange);

    // One timer covers both jobs: noticing a Classwork view that appeared
    // without a mutation we could observe, and finishing posts Classroom still
    // holds behind "View more". It is paused while the tab is in the background.
    pollTimer = window.setInterval(pollView, 1200);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pollView();
    });
    // Release the timer if the page is put in the back/forward cache.
    window.addEventListener('pagehide', () => {
      clearInterval(pollTimer);
      pollTimer = 0;
    });
    window.addEventListener('pageshow', () => {
      if (!pollTimer) pollTimer = window.setInterval(pollView, 1200);
    });

    // Listen for genuine user tab clicks (e.g. clicking Classwork tab)
    document.addEventListener(
      'click',
      (e) => {
        // Ignore programmatic clicks dispatched by extension
        if (!e.isTrusted) return;

        const target = e.target.closest('a, button, [role="tab"]');
        if (!target) return;

        // Ignore clicks on our own toggle buttons
        if (target.classList.contains(CLASS.toggle) || target.closest(`.${CLASS.ui}`)) {
          return;
        }

        const role = target.getAttribute('role');
        const label = (target.getAttribute('aria-label') || '').toLowerCase();
        const text = (target.textContent || '').toLowerCase();
        const href = target.getAttribute('href') || '';

        // Only reset when user clicks the main Classwork navigation tab
        if (
          (role === 'tab' || target.tagName === 'A') &&
          (text.includes('classwork') || label.includes('classwork') || href.includes('/w/'))
        ) {
          // Reuse whatever is already loaded: no bar unless posts are missing.
          resetAllToDefault();
          scheduleScan(150);
          requestExpansion(150);
        }
      },
      true
    );

    // Load every post of every topic, then apply the 5-post windows.
    // On later visits the posts are already in the DOM and nothing is fetched.
    scan();
    requestExpansion(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Test and diagnostic hooks
  window.__classroomPlusPlus = {
    scan,
    scheduleScan,
    diagnose,
    isDraftItem,
    findLatestPostIndex,
    alignLatestPostToMiddle,
    resetAllToDefault,
    expandAllTopics: triggerAutoExpansion,
    triggerAutoExpansion,
    requestExpansion,
    countLoadedPosts,
    isClassworkView,
    isToReviewView,
    markSelectedAsReviewed,
    setBulkReviewEnabled(on) {
      bulkReviewEnabled = on !== false;
      updateReviewMode();
    },
    isBulkReviewEnabled: () => bulkReviewEnabled,
    setClassworkLayoutEnabled(on) {
      classworkLayoutEnabled = on !== false;
      scan();
    },
    isClassworkLayoutEnabled: () => classworkLayoutEnabled,
    ensurePostsLoaded,
    pollView,
    viewSignature,
    syncWindowHeight,
    toggleSortOrder,
    getIsReversed: () => isReversed,
    recenterAllTopics,
    ensureSortToggleButton,
    reset() {
      for (const container of Array.from(activeContainers)) teardown(container);
    },
  };
})();

