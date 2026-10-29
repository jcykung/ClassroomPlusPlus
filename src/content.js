/**
 * Classroom++ — content script.
 *
 * On Google Classroom's Classwork page:
 * 1. Limits visible posts in each Topic section to 5 posts by default.
 *    (User can click "View all" to expand to show all posts in the Topic).
 * 2. Each Topic section is scrollable through all posts.
 * 3. By default (on entering/returning to Classwork), scrolls so that
 *    the latest published post (not drafts) is aligned to the middle
 *    of the scroll (the 3rd post of the 5 showing), allowing the user to
 *    see what came before and what needs to be edited and posted next.
 */
(() => {
  'use strict';

  const CONFIG = {
    /** How many posts fit in a collapsed topic window. */
    visiblePosts: 5,
    /** Topics with this many posts or fewer are left untouched. */
    minPostsToWindow: 6,
    /** Set true for console logging while debugging selectors. */
    debug: true,
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
    tail: '--cpp-tail-space',
  };

  const MAIN_SELECTOR = '[role="main"], main, #yDmH0d, body';
  const ROLE_ITEM_SELECTOR = 'li[data-stream-item-id], [data-stream-item-id], [role="listitem"]';
  const SKIP_ANCESTOR_SELECTOR =
    'aside, nav, [role="navigation"], [role="complementary"], [role="dialog"], [aria-modal="true"]';

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

  const log = (...args) => {
    if (CONFIG.debug) console.log('[Classroom++]', ...args);
  };

  /** Track whether we're in the middle of expanding Google's hidden posts. */
  let isExpanding = false;
  /** Track whether we've injected our CSS to hide Google's View more. */
  let viewMoreCssInjected = false;

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
   */
  function findLatestPostIndex(items) {
    if (!items || items.length === 0) return 0;

    const publishedIndices = [];
    const draftIndices = [];
    for (let i = 0; i < items.length; i++) {
      if (isDraftItem(items[i])) {
        draftIndices.push(i);
      } else {
        publishedIndices.push(i);
      }
    }

    if (publishedIndices.length === 0) return 0;

    // If there are drafts, determine if drafts are at the top or bottom
    if (draftIndices.length > 0) {
      const firstDraft = draftIndices[0];
      const lastDraft = draftIndices[draftIndices.length - 1];

      // If drafts are at the top (before all published posts):
      // The latest published post is the first published post after the drafts
      if (lastDraft < publishedIndices[0]) {
        return publishedIndices[0];
      }

      // If drafts are at the bottom (or after published posts):
      // The latest published post is the last published post before the drafts
      const beforeDrafts = publishedIndices.filter((idx) => idx < firstDraft);
      if (beforeDrafts.length > 0) {
        return beforeDrafts[beforeDrafts.length - 1];
      }
    }

    // Default / All published posts:
    // In sequence, the latest post is the last published post
    return publishedIndices[publishedIndices.length - 1];
  }

  /**
   * Align the scroll window so that the target post is the 3rd post of 5 visible posts
   * (aligned to the middle of the scroll). Supports both standard and reversed sort orders.
   */
  function alignLatestPostToMiddle(container, items, targetIndex, reversed = false) {
    if (!items || items.length === 0) return;

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
      const cRect = container.getBoundingClientRect();
      const iRect = topItem.getBoundingClientRect();
      const delta = iRect.top - cRect.top;
      container.scrollTop = Math.max(0, Math.round(container.scrollTop + delta));
    };

    applyScroll();
    requestAnimationFrame(() => {
      applyScroll();
      setTimeout(applyScroll, 80);
      setTimeout(applyScroll, 220);
    });
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
   * Strategy 1 (Native Classroom): [data-topic-id] sections and their <ol>/<ul> list of posts.
   * Strategy 2 (Heading-based): <h2> topic headings and their associated post lists.
   * Strategy 3 (Role/Tag): <ol>, <ul>, or [role="list"] with [data-stream-item-id] or [role="listitem"].
   * Strategy 4 (Fallback): Work links matching assignment paths.
   */
  function collectGroups(main) {
    const groups = new Map();
    const seenContainers = new Set();

    // Strategy 1: Google Classroom native [data-topic-id]
    const topicNodes = Array.from(main.querySelectorAll('[data-topic-id]')).filter(
      (node) => !node.closest(SKIP_ANCESTOR_SELECTOR)
    );

    for (const topicNode of topicNodes) {
      // Find the posts container: ol, ul, role="list", or the sibling following header
      let list = topicNode.querySelector('ol, ul, [role="list"]');
      if (!list) {
        // Look for element right after the topic header (div[jsname="K3jAGe"])
        const header = topicNode.querySelector('[jsname="K3jAGe"]') || topicNode.firstElementChild;
        if (header && header.nextElementSibling) {
          list = header.nextElementSibling;
        }
      }

      if (list && !seenContainers.has(list)) {
        let items = Array.from(
          list.querySelectorAll('li[data-stream-item-id], [data-stream-item-id], li, [role="listitem"]')
        ).filter(
          (item) => item.parentElement === list || item.closest('ol, ul, [role="list"]') === list
        );

        if (items.length === 0) {
          items = Array.from(list.children).filter(
            (c) => !c.classList.contains(CLASS.ui) && c.getBoundingClientRect().height > 10
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

      let list = topicSection.querySelector('ol, ul, [role="list"]');
      if (!list) {
        let sibling = (h2.closest('div') || h2).nextElementSibling;
        while (sibling) {
          if (
            sibling.matches &&
            (sibling.matches('ol, ul, [role="list"]') ||
              sibling.querySelector('li[data-stream-item-id], [data-stream-item-id], [role="listitem"]'))
          ) {
            list = sibling.matches('ol, ul, [role="list"]')
              ? sibling
              : (sibling.querySelector('ol, ul, [role="list"]') || sibling);
            break;
          }
          sibling = sibling.nextElementSibling;
        }
      }

      if (list && !seenContainers.has(list)) {
        let items = Array.from(
          list.querySelectorAll('li[data-stream-item-id], [data-stream-item-id], [role="listitem"]')
        ).filter(
          (item) => item.parentElement === list || item.closest('ol, ul, [role="list"]') === list
        );
        if (items.length === 0) {
          items = Array.from(list.children).filter(
            (c) => !c.classList.contains(CLASS.ui) && !c.classList.contains(CLASS.controls) && c.getBoundingClientRect().height > 10
          );
        }
        if (items.length > 0) {
          seenContainers.add(list);
          groups.set(list, items);
        }
      }
    }

    // Strategy 3: Any ol, ul, or [role="list"] containing items
    const roleLists = Array.from(main.querySelectorAll('ol, ul, [role="list"]')).filter(
      (l) => !seenContainers.has(l) && !l.closest(SKIP_ANCESTOR_SELECTOR)
    );
    for (const list of roleLists) {
      const items = Array.from(list.children).filter(
        (child) =>
          (child.matches && (child.matches('li, [data-stream-item-id], [role="listitem"]') || child.querySelector('[data-stream-item-id], [role="listitem"]'))) &&
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
    if (items.length < CONFIG.minPostsToWindow) return false;
    if (container === document.body || container === document.documentElement) return false;
    if (!container.isConnected) return false;
    if (container.closest(SKIP_ANCESTOR_SELECTOR)) return false;
    return true;
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
    const heights = sample.map((el) => el.getBoundingClientRect().height);
    if (heights.some((h) => !(h > 0))) return null;
    const gap = gapBetween(items);
    const contentHeight = heights.reduce((sum, h) => sum + h, 0) + gap * (heights.length - 1);
    if (!(contentHeight > 40)) return null;
    return {
      windowHeight: Math.round(contentHeight),
      avgHeight: contentHeight / heights.length,
      gap,
    };
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
        setExpanded(container, state, !state.expanded);
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

    if (!ui.isConnected || ui.previousElementSibling !== container) {
      container.insertAdjacentElement('afterend', ui);
    }

    // Toggle label: "View all" to expand, "View fewer" to collapse
    const textLabel = st.expanded ? 'View fewer' : `View all (${st.itemCount})`;
    const textSpan = st.button.querySelector(`.${CLASS.toggleText}`);
    if (textSpan && textSpan.textContent !== textLabel) {
      textSpan.textContent = textLabel;
    }
    st.button.setAttribute('aria-expanded', String(st.expanded));
    st.button.setAttribute('aria-label', st.expanded ? 'View fewer posts' : `View all ${st.itemCount} posts`);
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
      container.scrollTop = 0;
      ensureControls(container, st);
    }
  }

  function teardown(container) {
    container.classList.remove(CLASS.window, CLASS.expanded);
    for (const prop of Object.values(VARS)) container.style.removeProperty(prop);
    const st = stateByContainer.get(container);
    if (st && st.ui) st.ui.remove();
    stateByContainer.delete(container);
    activeContainers.delete(container);
  }

  function applyWindow(container, items) {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) {
      log('skipping hidden container');
      return;
    }

    let st = stateByContainer.get(container);
    if (!st) {
      st = {
        expanded: false,
        centered: false,
        items: [],
        ui: null,
        button: null,
        itemCount: 0,
      };
      stateByContainer.set(container, st);
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

    container.classList.add(CLASS.window);
    container.classList.toggle(CLASS.expanded, st.expanded);
    container.style.setProperty(VARS.height, `${metrics.windowHeight}px`);

    // Tail space: allows the latest post near the end of the topic
    // to sit comfortably at the 3rd position (middle of 5)
    const tail = Math.round(metrics.avgHeight * 2.2 + metrics.gap * 2);
    container.style.setProperty(VARS.tail, `${tail}px`);

    // Apply sort order (normal or reversed)
    applySortOrderToContainer(container, items, isReversed);

    // Setup drag auto-scroll and horizontal drop indicators
    setupDragAndDrop(container);

    ensureControls(container, st);

    if (st.expanded) return;

    if (!st.centered) {
      const latestIndex = findLatestPostIndex(items);
      alignLatestPostToMiddle(container, items, latestIndex, isReversed);
      st.centered = true;
    } else {
      container.scrollTop = previousScroll;
    }
  }

  // --- Drag & Drop Enhancements ---

  let activeDragContainer = null;
  let dragScrollSpeed = 0;
  let dragAutoScrollTimer = null;
  let dropIndicator = null;

  function getDropIndicator() {
    if (!dropIndicator || !dropIndicator.isConnected) {
      dropIndicator = document.createElement('div');
      dropIndicator.className = 'cpp-drop-indicator';
      dropIndicator.innerHTML = '<span class="cpp-drop-dot-left"></span><span class="cpp-drop-line"></span><span class="cpp-drop-dot-right"></span>';
      document.body.appendChild(dropIndicator);
    }
    return dropIndicator;
  }

  function hideDropIndicator() {
    if (dropIndicator) dropIndicator.style.display = 'none';
  }

  function showDropIndicator(container, item, isBefore) {
    const indicator = getDropIndicator();
    const cRect = container.getBoundingClientRect();
    const iRect = item.getBoundingClientRect();

    const y = isBefore ? iRect.top : iRect.bottom;
    if (y < cRect.top - 4 || y > cRect.bottom + 4) {
      hideDropIndicator();
      return;
    }

    indicator.style.display = 'flex';
    indicator.style.top = `${Math.round(y - 2)}px`;
    indicator.style.left = `${Math.round(Math.max(cRect.left, iRect.left) + 8)}px`;
    indicator.style.width = `${Math.round(Math.min(cRect.width, iRect.width) - 16)}px`;
  }

  function setupDragAndDrop(container) {
    if (container._cppDragAttached) return;
    container._cppDragAttached = true;

    // Eagerly create the drop indicator so it's in the DOM
    getDropIndicator();

    container.addEventListener('dragover', (e) => {
      const rect = container.getBoundingClientRect();
      const y = e.clientY;
      const topZone = rect.top + 55;
      const bottomZone = rect.bottom - 55;

      if (y < topZone) {
        const intensity = Math.max(0.2, (topZone - y) / 55);
        dragScrollSpeed = -Math.round(intensity * 18);
        startDragAutoScroll(container);
      } else if (y > bottomZone) {
        const intensity = Math.max(0.2, (y - bottomZone) / 55);
        dragScrollSpeed = Math.round(intensity * 18);
        startDragAutoScroll(container);
      } else {
        stopDragAutoScroll();
      }

      // Show drop indicator line above or below hovered post
      const item = e.target.closest('li[data-stream-item-id], [data-stream-item-id], [role="listitem"]');
      if (item && container.contains(item)) {
        const iRect = item.getBoundingClientRect();
        const isBefore = (e.clientY - iRect.top) < (iRect.height / 2);
        showDropIndicator(container, item, isBefore);
      }
    });

    container.addEventListener('dragleave', (e) => {
      if (!container.contains(e.relatedTarget)) {
        stopDragAutoScroll();
        hideDropIndicator();
      }
    });

    container.addEventListener('drop', () => {
      stopDragAutoScroll();
      hideDropIndicator();
    });
  }

  function startDragAutoScroll(container) {
    activeDragContainer = container;
    if (!dragAutoScrollTimer) {
      const step = () => {
        if (activeDragContainer && dragScrollSpeed !== 0) {
          activeDragContainer.scrollTop += dragScrollSpeed;
          dragAutoScrollTimer = requestAnimationFrame(step);
        } else {
          stopDragAutoScroll();
        }
      };
      dragAutoScrollTimer = requestAnimationFrame(step);
    }
  }

  function stopDragAutoScroll() {
    if (dragAutoScrollTimer) {
      cancelAnimationFrame(dragAutoScrollTimer);
      dragAutoScrollTimer = null;
    }
    activeDragContainer = null;
    dragScrollSpeed = 0;
  }

  document.addEventListener('dragend', () => {
    stopDragAutoScroll();
    hideDropIndicator();
  });

  // --- Sort Order (Reverse All Topics) ---

  function findCollapseAllButton() {
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
    const main = document.querySelector(MAIN_SELECTOR) || document.body;
    const firstTopic = main.querySelector('[data-topic-id], section, h2');
    if (firstTopic && firstTopic.parentElement) {
      const candidateBtn = firstTopic.parentElement.querySelector('button');
      if (candidateBtn && candidateBtn.id !== 'cpp-sort-toggle') return candidateBtn;
    }

    return null;
  }

  function ensureSortToggleButton() {
    const collapseBtn = findCollapseAllButton();
    let btn = document.getElementById('cpp-sort-toggle');

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

    if (btn.nextElementSibling !== collapseBtn) {
      collapseBtn.parentNode.insertBefore(btn, collapseBtn);
    }

    btn.classList.toggle('cpp-sort-active', isReversed);
    const textSpan = btn.querySelector('.cpp-sort-text');
    if (textSpan) {
      textSpan.textContent = isReversed ? 'Reverse order: ON' : 'Reverse order';
    }
  }

  function toggleSortOrder() {
    isReversed = !isReversed;
    try {
      localStorage.setItem(SORT_STORAGE_KEY, String(isReversed));
    } catch (_) {}

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

  /**
   * Inject CSS to hide Google Classroom's native "View more" links.
   * We replace them with our own 5-post scroll window + "View all" toggle.
   */
  function injectViewMoreHidingCSS() {
    if (viewMoreCssInjected) return;
    const style = document.createElement('style');
    style.id = 'cpp-hide-view-more';
    style.textContent = `
      /* Classroom++ — Visually hide Google Classroom's native "View more" button */
      button[aria-label*="View more" i],
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
      button[data-cpp-clicked="true"],
      .cpp-hidden-view-more {
        display: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    viewMoreCssInjected = true;
    log('injected CSS to hide native View more');
  }

  /**
   * Strictly verify if an element is Google Classroom's native "View more" button.
   * Must NOT match topic accordion buttons, post menus, or other Classroom buttons.
   */
  function isViewMoreButton(btn) {
    if (!btn || !btn.isConnected) return false;

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
   * Safely dispatch pointer, mouse, and click events to trigger Google Wiz/Closure actions.
   */
  function triggerClick(el) {
    if (!el) return;

    try {
      if (typeof el.focus === 'function') el.focus();
    } catch (_) {}

    const span = el.querySelector('span[jsname="V67aGc"]') || el;

    const opts = { bubbles: true, cancelable: true, view: window, composed: true };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      try {
        const isPointer = type.startsWith('pointer');
        const EventClass = isPointer ? PointerEvent : MouseEvent;
        span.dispatchEvent(new EventClass(type, opts));
      } catch (_) {}
    }

    try {
      if (typeof el.click === 'function') {
        el.click();
      } else {
        el.dispatchEvent(new MouseEvent('click', opts));
      }
    } catch (_) {}
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
        seen.add(btn);
        results.push(btn);
      }
    }

    // Also check other buttons strictly for "View more" text
    const allButtons = document.querySelectorAll('button, [role="button"]');
    for (const btn of allButtons) {
      if (!seen.has(btn) && !btn.dataset.cppClicked && isViewMoreButton(btn)) {
        seen.add(btn);
        results.push(btn);
      }
    }

    return results;
  }

  /**
   * Automatically expand all native "View more" buttons until all posts are revealed.
   * Handles multi-batch loading for topics with many posts (e.g. 30+ posts).
   * Uses fast dynamic polling so all hidden posts load almost instantaneously.
   */
  async function triggerAutoExpansion() {
    if (isExpanding) return;

    const initial = findUnclickedViewMore();
    if (initial.length === 0) return;

    isExpanding = true;
    injectViewMoreHidingCSS();

    try {
      for (let round = 0; round < 10; round++) {
        const buttons = findUnclickedViewMore();
        if (buttons.length === 0) break;

        log(`expanding ${buttons.length} native View more button(s) (round ${round + 1})`);

        for (const btn of buttons) {
          btn.dataset.cppClicked = 'true';
          btn.classList.add('cpp-native-view-more');
          triggerClick(btn);
        }

        // Fast dynamic polling: Classroom responds in 50-150ms per batch.
        // Poll every 40ms up to 450ms for new buttons to appear or items to mount.
        const start = Date.now();
        while (Date.now() - start < 450) {
          await new Promise((r) => setTimeout(r, 40));
          if (findUnclickedViewMore().length > 0) break;
        }
      }
    } catch (err) {
      console.error('[Classroom++] auto expansion error:', err);
    } finally {
      isExpanding = false;
      // Re-scan to apply window and update toggle count for all loaded posts
      scheduleScan(50);
    }
  }

  function scan() {
    if (scan._running) return;
    scan._running = true;
    try {
      ensureSortToggleButton();

      const main = document.querySelector(MAIN_SELECTOR) || document.body;
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
    }
  }

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
   * Check if current page is within the Classwork section.
   */
  function isClassworkView() {
    if (document.querySelector('[data-topic-id]')) return true;
    const path = location.pathname;
    if (/\/(?:w|c)\/[^/]+\/(?:t\/|w)/.test(path) || /\/w\/[^/]+/.test(path)) {
      return true;
    }
    const title = (document.title || '').toLowerCase();
    if (title.includes('classwork')) {
      return true;
    }
    const activeTab = document.querySelector('[role="tab"][aria-selected="true"], a[aria-current="page"]');
    if (activeTab && (activeTab.textContent || '').toLowerCase().includes('classwork')) {
      return true;
    }
    return false;
  }

  let lastPath = location.pathname;
  let lastWasClasswork = isClassworkView();

  function onNavigationChange() {
    const currentPath = location.pathname;
    const currentIsClasswork = isClassworkView();

    // When the user enters Classwork, or exits and comes back:
    if (currentIsClasswork && (!lastWasClasswork || currentPath !== lastPath)) {
      resetAllToDefault();
    }

    lastPath = currentPath;
    lastWasClasswork = currentIsClasswork;
    triggerAutoExpansion().then(() => scheduleScan(100));
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
    return !!el && el.classList && el.classList.contains
      ? el.classList.contains(CLASS.ui) || el.closest(`.${CLASS.ui}`) !== null
      : false;
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type !== 'childList') continue;
      const nodes = Array.from(record.addedNodes).concat(Array.from(record.removedNodes));
      if (!nodes.length) continue;
      if (nodes.every(isOurNode)) continue;

      // Unhide all posts by expanding any native View more buttons
      triggerAutoExpansion();
      scheduleScan();
      return;
    }
  });

  // Also check URL changes periodically in case of silent SPA navigation
  setInterval(() => {
    if (location.pathname !== lastPath) {
      onNavigationChange();
    }
  }, 500);

  function diagnose() {
    const main = document.querySelector(MAIN_SELECTOR) || document.body;
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
          latestIsDraft: isDraftItem(items[latestIdx]),
          hidden: container.getBoundingClientRect().width === 0,
        };
      }),
      enhanced: activeContainers.size,
    };
  }

  function init() {
    injectViewMoreHidingCSS();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('resize', () => scheduleScan());
    window.addEventListener('popstate', onNavigationChange);
    window.addEventListener('hashchange', onNavigationChange);

    // Listen for genuine user tab clicks (e.g. clicking Classwork tab)
    document.addEventListener('click', (e) => {
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
        resetAllToDefault();
        triggerAutoExpansion().then(() => scheduleScan(200));
      }
    }, true);

    // Unhide all posts by expanding Google's View more buttons, then scan
    triggerAutoExpansion().then(() => scan());
    setTimeout(() => triggerAutoExpansion(), 1200);
    setTimeout(() => triggerAutoExpansion(), 2500);
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
    toggleSortOrder,
    getIsReversed: () => isReversed,
    recenterAllTopics,
    ensureSortToggleButton,
    reset() {
      for (const container of Array.from(activeContainers)) teardown(container);
    },
  };
})();

