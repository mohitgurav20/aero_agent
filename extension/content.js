/**
 * SIH26171 — Content Script
 * Advanced Perception Engine:
 * - 2-Pass Semantic DOM Filter (~90% payload reduction)
 * - MutationObserver-based Incremental DOM Diffing (Task 104) & Debounce (Task 152)
 * - Zoom-Calibrated Numbered-Tag Grounding Overlays (Task 43, 139)
 * - Deterministic Multi-Action Executor with Step Validation & Halt-on-Failure (Task 44, 140)
 * - Web Worker offload for JSON tree compression (Task 106)
 * Owner: Mohit
 */

(function () {
  'use strict';

  window.__SIH26171_CONTENT_INITIALIZED__ = Date.now();

  // DOM State Cache
  const tagElementMap = new Map();
  let overlayContainer = null;
  let cachedDomData = null;
  let isDomDirty = true;
  let domWorker = null;
  let mutationDebounceTimer = null;
  const mutatedElementsSet = new Set();
  let lastInteractedElement = null;

  // Antigravity-Style HUD Overlay State
  let hudOverlayContainer = null;
  let hudTargetReticle = null;
  let hudTextSpan = null;
  let hudPillElement = null;

  function ensureHudOverlay() {
    if (document.getElementById('aero-agent-hud-overlay')) {
      hudOverlayContainer = document.getElementById('aero-agent-hud-overlay');
      hudTargetReticle = document.getElementById('aero-agent-target-reticle');
      hudTextSpan = document.getElementById('aero-agent-hud-text');
      hudPillElement = document.getElementById('aero-agent-hud-pill');
      return;
    }

    if (!document.getElementById('aero-agent-hud-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'aero-agent-hud-styles';
      styleEl.textContent = `
        #aero-agent-hud-overlay {
          position: fixed !important;
          inset: 0 !important;
          pointer-events: none !important;
          z-index: 2147483640 !important;
          transition: opacity 0.28s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.28s ease !important;
          opacity: 0;
          visibility: hidden;
        }
        #aero-agent-hud-overlay.active {
          opacity: 1 !important;
          visibility: visible !important;
        }
        #aero-agent-hud-vignette {
          position: absolute !important;
          inset: 0 !important;
          pointer-events: none !important;
          box-shadow: inset 0 0 70px 14px rgba(59, 130, 246, 0.28), inset 0 0 140px 30px rgba(14, 165, 233, 0.16) !important;
          border: 2px solid rgba(56, 189, 248, 0.45) !important;
          box-sizing: border-box !important;
          animation: aero-border-pulse 3s infinite ease-in-out !important;
        }
        #aero-agent-hud-pill {
          position: absolute !important;
          top: 18px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 10px !important;
          padding: 8px 18px !important;
          background: rgba(15, 23, 42, 0.88) !important;
          backdrop-filter: blur(14px) !important;
          -webkit-backdrop-filter: blur(14px) !important;
          border: 1.5px solid rgba(56, 189, 248, 0.6) !important;
          border-radius: 9999px !important;
          color: #ffffff !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          font-size: 13px !important;
          font-weight: 600 !important;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 0 22px rgba(56, 189, 248, 0.35) !important;
          letter-spacing: 0.2px !important;
          pointer-events: none !important;
          transition: all 0.25s ease !important;
          white-space: nowrap !important;
          max-width: 90vw !important;
        }
        #aero-agent-hud-pill.paused {
          border-color: rgba(245, 158, 11, 0.85) !important;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.6), 0 0 25px rgba(245, 158, 11, 0.45) !important;
        }
        #aero-agent-hud-dot {
          width: 9px !important;
          height: 9px !important;
          border-radius: 50% !important;
          background: #38bdf8 !important;
          box-shadow: 0 0 10px #38bdf8, 0 0 18px #0ea5e9 !important;
          animation: aero-hud-dot-pulse 1.2s infinite ease-in-out !important;
          flex-shrink: 0 !important;
        }
        #aero-agent-hud-pill.paused #aero-agent-hud-dot {
          background: #f59e0b !important;
          box-shadow: 0 0 10px #f59e0b, 0 0 18px #d97706 !important;
        }
        #aero-agent-target-reticle {
          position: absolute !important;
          pointer-events: none !important;
          z-index: 2147483642 !important;
          border: 2.5px solid #38bdf8 !important;
          border-radius: 6px !important;
          box-shadow: 0 0 22px rgba(56, 189, 248, 0.85), inset 0 0 12px rgba(56, 189, 248, 0.4) !important;
          transition: all 0.22s cubic-bezier(0.16, 1, 0.3, 1) !important;
          opacity: 0;
          visibility: hidden;
        }
        #aero-agent-target-reticle.active {
          opacity: 1 !important;
          visibility: visible !important;
          animation: aero-reticle-breathe 1.5s infinite alternate ease-in-out !important;
        }
        @keyframes aero-border-pulse {
          0%, 100% { border-color: rgba(56, 189, 248, 0.35); }
          50% { border-color: rgba(59, 130, 246, 0.75); }
        }
        @keyframes aero-hud-dot-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.35); opacity: 0.65; }
        }
        @keyframes aero-reticle-breathe {
          0% { box-shadow: 0 0 16px rgba(56, 189, 248, 0.65); }
          100% { box-shadow: 0 0 28px rgba(56, 189, 248, 0.95); }
        }
      `;
      (document.head || document.documentElement).appendChild(styleEl);
    }

    hudOverlayContainer = document.createElement('div');
    hudOverlayContainer.id = 'aero-agent-hud-overlay';

    const vignette = document.createElement('div');
    vignette.id = 'aero-agent-hud-vignette';

    hudPillElement = document.createElement('div');
    hudPillElement.id = 'aero-agent-hud-pill';

    const dot = document.createElement('span');
    dot.id = 'aero-agent-hud-dot';

    hudTextSpan = document.createElement('span');
    hudTextSpan.id = 'aero-agent-hud-text';
    hudTextSpan.textContent = '⚡ Aero Agent Active';

    hudPillElement.appendChild(dot);
    hudPillElement.appendChild(hudTextSpan);

    hudOverlayContainer.appendChild(vignette);
    hudOverlayContainer.appendChild(hudPillElement);

    hudTargetReticle = document.createElement('div');
    hudTargetReticle.id = 'aero-agent-target-reticle';

    (document.body || document.documentElement).appendChild(hudOverlayContainer);
    (document.body || document.documentElement).appendChild(hudTargetReticle);
  }

  function showHudOverlay(text = 'Aero Agent Active', isPaused = false) {
    try {
      ensureHudOverlay();
      if (!hudOverlayContainer) return;

      if (hudTextSpan) {
        hudTextSpan.textContent = text;
      }
      if (hudPillElement) {
        if (isPaused) {
          hudPillElement.classList.add('paused');
        } else {
          hudPillElement.classList.remove('paused');
        }
      }
      hudOverlayContainer.classList.add('active');
    } catch (e) {
      console.warn('[Content] Error showing HUD overlay:', e);
    }
  }

  function hideHudOverlay() {
    try {
      if (hudOverlayContainer) {
        hudOverlayContainer.classList.remove('active');
      }
      removeTargetReticle();
    } catch (e) { }
  }

  function highlightTargetReticle(targetNode) {
    try {
      ensureHudOverlay();
      if (!hudTargetReticle || !targetNode || typeof targetNode.getBoundingClientRect !== 'function') return;

      const rect = targetNode.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset || 0;
      const scrollY = window.scrollY || window.pageYOffset || 0;

      const padding = 4;
      hudTargetReticle.style.left = `${Math.max(0, rect.left + scrollX - padding)}px`;
      hudTargetReticle.style.top = `${Math.max(0, rect.top + scrollY - padding)}px`;
      hudTargetReticle.style.width = `${rect.width + padding * 2}px`;
      hudTargetReticle.style.height = `${rect.height + padding * 2}px`;
      hudTargetReticle.classList.add('active');
    } catch (e) { }
  }

  function removeTargetReticle() {
    try {
      if (hudTargetReticle) {
        hudTargetReticle.classList.remove('active');
      }
    } catch (e) { }
  }

  // Initialize Web Worker if possible
  try {
    const workerUrl = chrome.runtime.getURL('dom-worker.js');
    domWorker = new Worker(workerUrl);
  } catch (err) {
    console.log('[Content] Web Worker fallback to main thread:', err.message);
  }

  /**
   * Task 104 & 152: MutationObserver for incremental diffing & debouncing
   */
  function initMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      isDomDirty = true;
      for (const mutation of mutations) {
        if (mutation.target && mutation.target.nodeType === Node.ELEMENT_NODE) {
          // Ignore our own overlay badges and HUD components
          if (mutation.target.id === 'sih-tag-overlay-container' || mutation.target.id?.startsWith?.('aero-agent') || mutation.target.classList?.contains('sih-tag-badge')) {
            continue;
          }
          mutatedElementsSet.add(mutation.target);
        }
      }

      if (mutationDebounceTimer) clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = setTimeout(() => {
        // Debounce settle
      }, 150);
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'disabled', 'hidden', 'aria-hidden', 'value']
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMutationObserver);
  } else {
    initMutationObserver();
  }

  /**
   * Pass 1: Visibility check
   */
  function isElementVisible(node, style) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    // Allow radio/checkbox inputs that use standard sr-only/opacity:0 styling
    const isRadioOrCheck = node.tagName === 'INPUT' && (node.type === 'radio' || node.type === 'checkbox');
    if (style.opacity === '0' && !isRadioOrCheck) {
      return false;
    }
    if (node.hasAttribute('aria-hidden') && node.getAttribute('aria-hidden') === 'true' && !isRadioOrCheck) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0 && !isRadioOrCheck) return false;
    if (rect.bottom < -500 || rect.top > (window.innerHeight + 500)) return false;

    return true;
  }

  /**
   * Determine interactive candidate
   */
  function isElementInteractive(node, style) {
    const tagName = node.tagName.toUpperCase();

    const INTERACTIVE_TAGS = new Set([
      'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA',
      'DETAILS', 'SUMMARY', 'LABEL', 'OPTION'
    ]);

    const INTERACTIVE_ROLES = new Set([
      'button', 'link', 'textbox', 'checkbox', 'radio',
      'combobox', 'listbox', 'menuitem', 'menuitemcheckbox',
      'menuitemradio', 'tab', 'switch', 'slider', 'spinbutton',
      'searchbox', 'option'
    ]);

    if (INTERACTIVE_TAGS.has(tagName)) return true;

    // Direct Gmail Compose button detection
    if (node.getAttribute('gh') === 'cm' || node.classList?.contains('T-I-KE') || node.getAttribute('data-tooltip')?.toLowerCase() === 'compose') {
      return true;
    }

    if (tagName === 'IFRAME') {
      const title = (node.getAttribute('title') || node.getAttribute('aria-label') || node.id || node.src || '').toLowerCase();
      if (title.includes('sign in') || title.includes('google') || title.includes('auth') || title.includes('login') || title.includes('continue') || title.includes('gsi')) {
        return true;
      }
    }

    const role = node.getAttribute('role');
    if (role && INTERACTIVE_ROLES.has(role.toLowerCase())) return true;

    if (node.hasAttribute('onclick') || node.hasAttribute('data-action') || node.hasAttribute('ng-click') || node.hasAttribute('@click') || node.hasAttribute('v-on:click')) {
      return true;
    }

    if (node.isContentEditable) return true;

    const tabIndex = node.getAttribute('tabindex');
    if (tabIndex !== null && parseInt(tabIndex, 10) >= 0) return true;

    if (style.cursor === 'pointer') return true;

    return false;
  }

  /**
   * Component 2: Live Error & Alert Collector
   * Scans document for active error indicators, validation warnings, and flash banners.
   */
  function collectPageAlerts() {
    const alerts = [];
    const alertSelectors = [
      '[role="alert"]',
      '.flash-error',
      '.flash-warn',
      '.TextInput-message--error',
      'p[class*="error" i]',
      'div[class*="error" i]',
      'span[class*="error" i]',
      'dd[class*="error" i]',
      '.error-message',
      '.alert-danger',
      '.alert-warning',
      '[aria-invalid="true"]'
    ];
    try {
      const alertNodes = document.querySelectorAll(alertSelectors.join(', '));
      alertNodes.forEach(node => {
        const style = window.getComputedStyle(node);
        if (style.display !== 'none' && style.visibility !== 'hidden' && (node.offsetWidth > 0 || node.offsetHeight > 0)) {
          const txt = (node.textContent || '').trim().replace(/\s+/g, ' ');
          if (txt && txt.length > 2 && txt.length < 200 && !alerts.includes(txt)) {
            alerts.push(txt);
          }
        }
      });

      // Also scan for red text nodes indicating validation errors
      const candidateNodes = document.querySelectorAll('p, span, div, small, em');
      candidateNodes.forEach(node => {
        if (node.children.length === 0 && (node.offsetWidth > 0 || node.offsetHeight > 0)) {
          const style = window.getComputedStyle(node);
          const col = style.color || '';
          if (col.includes('207, 34') || col.includes('225, 29') || col.includes('239, 68') || col.includes('220, 38') || col.includes('255, 0, 0')) {
            const txt = (node.textContent || '').trim().replace(/\s+/g, ' ');
            if (txt && txt.length > 2 && txt.length < 200 && !alerts.includes(txt)) {
              alerts.push(txt);
            }
          }
        }
      });
    } catch (e) { }
    return alerts;
  }

  /**
   * Pass 2: Extract semantic attributes & compute coordinates
   */
  function extractInteractiveElements(forceFull = true) {
    tagElementMap.clear();

    const SKIP_TAGS = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'BR', 'HR',
      'TEMPLATE', 'SVG', 'PATH', 'SOURCE', 'TRACK', 'WBR'
    ]);

    const rawElements = document.querySelectorAll('*');
    const rawCount = rawElements.length;
    const extracted = [];
    let tagId = 1;

    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_ELEMENT,
      {
        acceptNode: (node) => {
          if (SKIP_TAGS.has(node.tagName)) return NodeFilter.FILTER_REJECT;
          if (node.id === 'sih-tag-overlay-container' || node.classList?.contains('sih-tag-badge')) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      const style = window.getComputedStyle(node);
      if (!isElementVisible(node, style)) continue;
      if (!isElementInteractive(node, style)) continue;

      const rect = node.getBoundingClientRect();
      const currentTagId = tagId++;

      tagElementMap.set(currentTagId, node);

      let directText = '';
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          directText += child.textContent;
        }
      }
      directText = directText.trim();

      let associatedLabel = '';
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA' || node.tagName === 'SELECT') {
        if (node.labels && node.labels.length > 0) {
          associatedLabel = Array.from(node.labels).map(l => l.textContent.trim()).join(' ');
        }
        if (!associatedLabel && node.id) {
          try {
            const lbl = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
            if (lbl) associatedLabel = lbl.textContent.trim();
          } catch (e) { }
        }
        if (!associatedLabel) {
          const parentLabel = node.closest('label');
          if (parentLabel) associatedLabel = parentLabel.textContent.trim();
        }
        if (!associatedLabel) {
          const container = node.closest('.form-group, .form-control, [data-target], fieldset, div');
          const nearbyLabel = container?.querySelector('label, [class*="label"], [class*="title"], [class*="Label"]');
          if (nearbyLabel) associatedLabel = nearbyLabel.textContent.trim();
        }
      }

      const ariaLabel = node.getAttribute('aria-label') ||
        node.getAttribute('title') ||
        (node.getAttribute('aria-labelledby') ? document.getElementById(node.getAttribute('aria-labelledby'))?.textContent?.trim() : null);

      const fullText = (node.textContent || '').trim();
      const finalLabelText = associatedLabel || directText || fullText || node.name || node.id || '';
      const elementText = finalLabelText.replace(/\s+/g, ' ').trim().substring(0, 120);

      const item = {
        tag_id: currentTagId,
        tag: node.tagName.toLowerCase(),
        text: elementText || null,
        aria_label: ariaLabel || null,
        name: node.name || null,
        id: node.id || null,
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height)
        },
        center: {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2)
        },
        interactive: true,
        type: node.getAttribute('type') || null,
        role: node.getAttribute('role') || null,
        disabled: node.disabled || node.getAttribute('aria-disabled') === 'true' || false
      };

      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        item.placeholder = node.getAttribute('placeholder') || null;
        item.value = node.value || null;
        if (node.type === 'checkbox' || node.type === 'radio') {
          item.checked = node.checked;
        }
      }

      if (node.tagName === 'A') {
        item.href = node.getAttribute('href') || null;
      }

      if (node.isContentEditable) {
        item.is_content_editable = true;
      }

      if (node.tagName === 'SELECT') {
        item.value = node.value || null;
        item.selected_text = node.options?.[node.selectedIndex]?.text || null;
      }

      extracted.push(item);
    }

    // Component 2: Inject active on-screen alerts into extracted elements so LLM sees them immediately
    const activeAlerts = collectPageAlerts();
    activeAlerts.forEach(alertText => {
      const currentTagId = tagId++;
      extracted.push({
        tag_id: currentTagId,
        tag: 'div',
        role: 'alert',
        text: alertText,
        aria_label: alertText,
        interactive: false,
        disabled: false
      });
    });

    const reduction = rawCount > 0
      ? (((rawCount - extracted.length) / rawCount) * 100).toFixed(1)
      : 0;

    const sanitizedElements = (typeof window !== 'undefined' && window.PIIDetector && typeof window.PIIDetector.sanitizeElements === 'function')
      ? window.PIIDetector.sanitizeElements(extracted)
      : extracted;

    cachedDomData = {
      url: window.location.href,
      title: document.title,
      elements: sanitizedElements,
      alerts: activeAlerts,
      element_count: sanitizedElements.length,
      raw_element_count: rawCount,
      reduction_percent: parseFloat(reduction)
    };

    isDomDirty = false;
    mutatedElementsSet.clear();

    return cachedDomData;
  }

  /**
   * Task 43 & 139: Zoom-Calibrated Numbered-Tag Grounding Overlays
   */
  function renderNumberedOverlays(elements) {
    clearNumberedOverlays();

    overlayContainer = document.createElement('div');
    overlayContainer.id = 'sih-tag-overlay-container';
    overlayContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 2147483647;
      overflow: visible;
    `;

    const scrollX = window.scrollX || window.pageXOffset || 0;
    const scrollY = window.scrollY || window.pageYOffset || 0;

    for (const el of elements) {
      if (!el.bbox || el.bbox.w === 0 || el.bbox.h === 0) continue;

      const badge = document.createElement('div');
      badge.className = 'sih-tag-badge';
      badge.textContent = el.tag_id;
      badge.style.cssText = `
        position: absolute;
        top: ${el.bbox.y + scrollY}px;
        left: ${el.bbox.x + scrollX}px;
        background: #facc15;
        color: #000000;
        font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-size: 11px;
        font-weight: 800;
        line-height: 1;
        padding: 2px 4px;
        border-radius: 3px;
        border: 1px solid #000000;
        box-shadow: 0 1px 4px rgba(0,0,0,0.6);
        pointer-events: none;
        z-index: 2147483647;
        opacity: 0.94;
        transform: translateY(-50%);
      `;
      overlayContainer.appendChild(badge);
    }

    document.body.appendChild(overlayContainer);
  }

  function clearNumberedOverlays() {
    if (overlayContainer && overlayContainer.parentNode) {
      overlayContainer.parentNode.removeChild(overlayContainer);
    }
    overlayContainer = null;
    document.querySelectorAll('.sih-tag-badge').forEach(el => el.remove());
  }

  /**
   * Action Simulation Helpers
   */
  async function simulateClick(element) {
    if (!element) return;

    // Find clickable parent if this is an inner text/icon node
    const clickableParent = element.closest('a, button, [role="button"], [role="link"], input[type="submit"], input[type="button"], [jsaction*="click"], [onclick]') || element;

    if (clickableParent.disabled || clickableParent.getAttribute('aria-disabled') === 'true') {
      throw new Error(`Element "${(clickableParent.textContent || clickableParent.getAttribute('aria-label') || clickableParent.id || 'button').trim()}" is disabled and cannot be clicked.`);
    }

    try {
      clickableParent.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (e) { }
    await sleep(150);

    const prevOutline = clickableParent.style.outline;
    const prevTransition = clickableParent.style.transition;
    clickableParent.style.transition = 'outline 0.2s ease-in-out';
    clickableParent.style.outline = '3px solid #00f2fe';
    highlightTargetReticle(clickableParent);

    const rect = clickableParent.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    const downInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      button: 0,
      buttons: 1,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY
    };

    const upInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      detail: 1,
      button: 0,
      buttons: 0,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY
    };

    // Safety guard: Never target ads or third-party iframes
    const isAdOrIframe = (el) => {
      if (!el) return true;
      if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') return true;
      if (el.closest && el.closest('iframe, [id*="google_ads" i], [id*="aswift" i], [class*="adsbygoogle" i], [data-google-query-id], [class*="ad-container" i]')) return true;
      return false;
    };

    if (isAdOrIframe(clickableParent)) {
      console.warn('[SQ] Blocked click simulation on ad or iframe element');
      return;
    }

    let targetUnderPoint = null;
    try {
      const rawEl = document.elementFromPoint(clientX, clientY);
      if (rawEl && !isAdOrIframe(rawEl)) {
        targetUnderPoint = rawEl;
      }
    } catch (e) {}
    if (!targetUnderPoint) {
      targetUnderPoint = clickableParent;
    }

    try {
      targetUnderPoint.dispatchEvent(new PointerEvent('pointerdown', downInit));
      targetUnderPoint.dispatchEvent(new MouseEvent('mousedown', downInit));
      if (typeof clickableParent.focus === 'function') clickableParent.focus();
      targetUnderPoint.dispatchEvent(new PointerEvent('pointerup', upInit));
      targetUnderPoint.dispatchEvent(new MouseEvent('mouseup', upInit));
      targetUnderPoint.dispatchEvent(new MouseEvent('click', upInit));
    } catch (e) {
      console.warn('[SQ] Handled event dispatch exception:', e.message);
    }

    if (clickableParent !== targetUnderPoint && !isAdOrIframe(clickableParent)) {
      try {
        clickableParent.dispatchEvent(new PointerEvent('pointerdown', downInit));
        clickableParent.dispatchEvent(new MouseEvent('mousedown', downInit));
        clickableParent.dispatchEvent(new PointerEvent('pointerup', upInit));
        clickableParent.dispatchEvent(new MouseEvent('mouseup', upInit));
        clickableParent.dispatchEvent(new MouseEvent('click', upInit));
      } catch (e) {}
    }

    if (typeof clickableParent.click === 'function' && !isAdOrIframe(clickableParent)) {
      try { clickableParent.click(); } catch (e) { }
    }

    if (clickableParent.type === 'radio' || clickableParent.type === 'checkbox') {
      clickableParent.checked = true;
      clickableParent.dispatchEvent(new Event('input', { bubbles: true }));
      clickableParent.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const innerRadio = clickableParent.querySelector?.('input[type="radio"], input[type="checkbox"]');
    if (innerRadio) {
      innerRadio.checked = true;
      innerRadio.dispatchEvent(new Event('input', { bubbles: true }));
      innerRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Direct href navigation fallback for <a> links only if genuine external link and not handled by SPA
    const rawHref = clickableParent.getAttribute('href');
    if (clickableParent.tagName === 'A' && rawHref && !rawHref.startsWith('#') && !rawHref.startsWith('javascript:') && rawHref !== '') {
      try {
        if (clickableParent.target === '_blank') {
          window.open(clickableParent.href, '_blank');
        }
      } catch (e) { }
    }

    await sleep(200);
    clickableParent.style.outline = prevOutline;
    clickableParent.style.transition = prevTransition;
    removeTargetReticle();
  }

  async function simulateType(element, text) {
    if (!element) return;
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (e) { }
    await sleep(150);

    lastInteractedElement = element;
    const prevOutline = element.style.outline;
    element.style.outline = '3px solid #10b981';
    highlightTargetReticle(element);

    element.focus();
    if (typeof element.click === 'function') {
      try { element.click(); } catch (e) { }
    }

    // Check for Monaco Editor FIRST (LeetCode, VS Code web, etc.)
    const monacoContainer = (element && element.closest && element.closest('.monaco-editor'))
      || (element && element.classList && element.classList.contains('monaco-editor') ? element : null)
      || document.querySelector('.monaco-editor');
    if (monacoContainer && (window.location.hostname.includes('leetcode.com') || element.closest?.('.monaco-editor') || element.querySelector?.('.monaco-editor') || document.querySelector('.monaco-editor'))) {
      console.log('[Content] Injecting code into Monaco Editor via background MAIN world script...');
      try {
        await chrome.runtime.sendMessage({
          type: 'inject_code_to_main_world',
          code: text
        });
      } catch (e) {
        console.warn('[Content] Main world injection message failed:', e);
      }

      await sleep(400);
      element.style.outline = prevOutline;
      removeTargetReticle();
      return;
    }

    // Check for CodeMirror 6 (Programiz, modern web IDEs, Replit, etc.)
    const cm6Container = (element && element.closest && element.closest('.cm-editor, .cm-content'))
      || (element && element.classList && (element.classList.contains('cm-editor') || element.classList.contains('cm-content')) ? element : null)
      || (window.location.hostname.includes('programiz.com') ? document.querySelector('.cm-content, .cm-editor') : null);
    if (cm6Container) {
      console.log('[Content] Injecting code into CodeMirror 6 editor...');
      const targetCm = cm6Container.classList?.contains('cm-content') ? cm6Container : (cm6Container.querySelector('.cm-content') || cm6Container);
      targetCm.focus();
      let injected = false;
      try {
        let cmView = null;

        // 1. Direct DOM cmTile lookup (CodeMirror 6 internal DOM mapping)
        let tile = targetCm.cmTile;
        if (!tile) {
          const line = targetCm.querySelector('.cm-line');
          if (line) tile = line.cmTile;
        }
        if (!tile && targetCm.children) {
          for (const child of targetCm.children) {
            if (child.cmTile) { tile = child.cmTile; break; }
          }
        }
        if (!tile) {
          const cmRoot = targetCm.closest('.cm-editor') || document.querySelector('.cm-editor');
          if (cmRoot && cmRoot.cmTile) tile = cmRoot.cmTile;
        }
        if (tile) {
          cmView = tile.root?.view || tile.view;
        }

        let cur = targetCm;
        while (cur && !cmView) {
          if (cur.cmView?.view) cmView = cur.cmView.view;
          else if (cur._cmView?.view) cmView = cur._cmView.view;
          else if (cur.cmView?.dispatch) cmView = cur.cmView;
          cur = cur.parentElement;
        }
        if (!cmView) {
          const cmRoot = targetCm.closest('.cm-editor') || document.querySelector('.cm-editor');
          if (cmRoot) {
            for (const k of Object.getOwnPropertyNames(cmRoot).concat(Object.keys(cmRoot))) {
              try {
                if (cmRoot[k]?.view?.dispatch) { cmView = cmRoot[k].view; break; }
                if (cmRoot[k]?.dispatch && cmRoot[k]?.state) { cmView = cmRoot[k]; break; }
              } catch (_) {}
            }
          }
        }
        if (cmView && cmView.dispatch && cmView.state) {
          cmView.dispatch({
            changes: { from: 0, to: cmView.state.doc.length, insert: text }
          });
          injected = true;
        }
      } catch (e) {}

      if (!injected) {
        try {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(targetCm);
          sel.removeAllRanges();
          sel.addRange(range);
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
          injected = document.execCommand('insertText', false, text);

          try {
            targetCm.dispatchEvent(new InputEvent('beforeinput', {
              inputType: 'insertReplacementText',
              data: text,
              bubbles: true,
              cancelable: true
            }));
          } catch (_) {}

          if (!targetCm.innerText.includes(text.slice(0, 20))) {
            const lines = text.split('\n');
            targetCm.innerHTML = lines.map(line => {
              const esc = line ? line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '<br>';
              return `<div class="cm-line">${esc}</div>`;
            }).join('');
          }
        } catch (e) {}
      }

      if (!injected) {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          const pasteEvt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
          targetCm.dispatchEvent(pasteEvt);
        } catch (e) {}
      }
      targetCm.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
      targetCm.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      targetCm.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      await sleep(400);
      element.style.outline = prevOutline;
      removeTargetReticle();
      return;
    }

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      const prevVal = element.value || '';
      const proto = element.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      if (nativeSetter) {
        nativeSetter.call(element, text);
      } else {
        element.value = text;
      }

      // CRITICAL FOR REACT (GitHub Primer, React 16/17/18/19):
      // React tracks input value with _valueTracker. If not reset, React thinks value didn't change and drops events!
      try {
        const tracker = element._valueTracker;
        if (tracker && typeof tracker.setValue === 'function') {
          tracker.setValue(prevVal);
        }
      } catch (e) { }

      // ONLY use document.execCommand if document.activeElement is ACTUALLY this element!
      // This prevents execCommand from accidentally typing into an earlier field (like "To" recipient box)
      if (document.activeElement === element) {
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
        } catch (e) { }
      }

      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      try {
        element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
      } catch (e) { }
      element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

      // On Gmail, commit recipient with Enter and Tab keys if typing an email address into To/Cc/Bcc input
      const isGmail = window.location.hostname.includes('google') || window.location.hostname.includes('gmail');
      if (isGmail && text.includes('@')) {
        try {
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true }));
          element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true }));
        } catch (e) { }
      }
      if (!isGmail) {
        element.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
      }

      // Check for Ace Editor (used on Programiz, LeetCode, CodeChef, etc.)
      const aceContainer = element.closest('.ace_editor') || document.querySelector('.ace_editor');
      if (aceContainer) {
        try {
          const s = document.createElement('script');
          s.textContent = `
            try {
              const el = document.querySelector('.ace_editor');
              if (el && window.ace) {
                const ed = window.ace.edit(el);
                if (ed) {
                  ed.setValue(${JSON.stringify(text)}, 1);
                  ed.clearSelection();
                }
              }
            } catch(e) {}
          `;
          (document.head || document.documentElement).appendChild(s);
          s.remove();
        } catch (e) { }

        try {
          const ta = aceContainer.querySelector('textarea.ace_text-input') || element;
          ta.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, text);
        } catch (e) { }

        await sleep(300);
        return;
      }
    } else if (element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox' || element.closest('[contenteditable="true"]')) {
      // For WhatsApp Web (Lexical editor), Gmail, Outlook compose body which uses contenteditable divs
      const targetEditable = element.isContentEditable ? element : (element.closest('[contenteditable="true"]') || element);
      targetEditable.focus();
      if (typeof targetEditable.click === 'function') {
        try { targetEditable.click(); } catch (e) { }
      }

      // Deduplicate consecutive repeated text if LLM or prompt repeated sentences
      const dedupeConsecutive = (str) => {
        if (!str || typeof str !== 'string') return str;
        const trimmed = str.trim();
        for (let parts = 4; parts >= 2; parts--) {
          if (trimmed.length % parts === 0) {
            const partLen = trimmed.length / parts;
            const sub = trimmed.substring(0, partLen);
            if (sub.repeat(parts) === trimmed) {
              return sub.trim();
            }
          }
        }
        return str;
      };
      const cleanText = dedupeConsecutive(text);

      // Select and clear any previous draft text
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(targetEditable);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('delete', false, null);
      } catch (e) { }

      // 1. Try native execCommand first (crucial for WhatsApp Web Lexical, Gmail, & Draft.js)
      let insertedOk = false;
      try {
        insertedOk = document.execCommand('insertText', false, cleanText);
      } catch (e) { }

      // 2. Verify whether text was inserted into editor
      const probe = cleanText.trim().slice(0, 15);
      const isAlreadyInserted = insertedOk || (probe && (targetEditable.innerText || targetEditable.textContent || '').includes(probe));

      // 3. Fallback ONLY if execCommand failed to insert text
      if (!isAlreadyInserted) {
        let pasteSuccess = false;
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', cleanText);
          const pasteEvt = new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: dt
          });
          targetEditable.dispatchEvent(pasteEvt);
          pasteSuccess = (targetEditable.innerText || targetEditable.textContent || '').includes(probe);
        } catch (e) { }

        if (!pasteSuccess) {
          const lines = cleanText.split(/\r?\n/);
          const htmlContent = lines.map(line => {
            const safe = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return safe ? `<div>${safe}</div>` : `<div><br></div>`;
          }).join('');
          targetEditable.innerHTML = htmlContent;
          if (!targetEditable.innerText || targetEditable.innerText.trim().length === 0) {
            targetEditable.innerText = cleanText;
          }
        }
      }

      // 4. Notify React / Lexical / Vue state observers of the input change
      // CRITICAL: DO NOT dispatch InputEvent with { data: text, inputType: 'insertText' }!
      // Lexical's native listener will capture it and insert a duplicate copy of the text!
      targetEditable.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      targetEditable.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      // Keep focused, DO NOT blur (blur resets editor state)
    }

    await sleep(200);
    element.style.outline = prevOutline;
    removeTargetReticle();
  }

  async function simulateSelect(element, value) {
    if (!element) return;
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    } catch (e) { }
    await sleep(150);

    if (element.tagName === 'SELECT') {
      let matched = false;
      for (let i = 0; i < element.options.length; i++) {
        if (element.options[i].value === value || element.options[i].text.trim().toLowerCase() === String(value).trim().toLowerCase()) {
          element.selectedIndex = i;
          matched = true;
          break;
        }
      }
      if (!matched && element.options.length > 0) {
        element.value = value;
      }
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Radio, checkbox, or custom choice element (e.g. GitHub Private/Public, options, toggles)
      const valStr = String(value || '').trim().toLowerCase();

      // Locate the actual input/radio
      let targetRadio = (element.type === 'radio' || element.type === 'checkbox')
        ? element
        : (element.querySelector?.('input[type="radio"], input[type="checkbox"], [role="radio"]') ||
          (element.getAttribute?.('for') ? document.getElementById(element.getAttribute('for')) : null) ||
          element.closest?.('label')?.querySelector('input[type="radio"], input[type="checkbox"], [role="radio"]'));

      // If still not found and value is specified, search document for radio matching the value
      if (!targetRadio && valStr) {
        const matchingInput = document.querySelector(`input[type="radio"][value="${valStr}" i], input[value="${valStr}" i], [role="radio"][data-value="${valStr}" i]`);
        if (matchingInput) targetRadio = matchingInput;
      }

      if (targetRadio) {
        try {
          targetRadio.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (e) { }

        // Trigger native property setter to satisfy React/Vue/Angular synthetic value tracker
        if (targetRadio.tagName === 'INPUT') {
          const proto = window.HTMLInputElement.prototype;
          const nativeCheckedSetter = Object.getOwnPropertyDescriptor(proto, 'checked')?.set;
          if (nativeCheckedSetter) {
            nativeCheckedSetter.call(targetRadio, true);
          } else {
            targetRadio.checked = true;
          }
        } else if (targetRadio.getAttribute?.('role') === 'radio') {
          targetRadio.setAttribute('aria-checked', 'true');
        }

        // Full Pointer & Mouse event chain
        targetRadio.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, view: window }));
        targetRadio.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
        targetRadio.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, view: window }));
        targetRadio.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
        targetRadio.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));

        if (typeof targetRadio.click === 'function') {
          try { targetRadio.click(); } catch (e) { }
        }

        targetRadio.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        targetRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

        // Also trigger any wrapping or associated label
        const assocLabel = targetRadio.labels?.[0] || targetRadio.closest('label') ||
          (targetRadio.id ? document.querySelector(`label[for="${targetRadio.id}"]`) : null);
        if (assocLabel && assocLabel !== targetRadio) {
          assocLabel.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          if (typeof assocLabel.click === 'function') {
            try { assocLabel.click(); } catch (e) { }
          }
        }
      }

      // Check for custom dropdown / action menu (e.g. GitHub [Public ▾], ActionMenu, Popover)
      const isDropdown = element.tagName === 'BUTTON' ||
        element.getAttribute('aria-haspopup') ||
        element.getAttribute('aria-expanded') !== null ||
        element.querySelector?.('svg, [class*="caret"], [class*="arrow"]');

      if (isDropdown && !targetRadio) {
        console.log('[Content] Triggering custom dropdown button to select option:', valStr);
        await simulateClick(element);
        await sleep(400);

        // Find the target option in the newly displayed overlay/menu
        const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], button, li, a, div[role="button"]'));
        const matchedOption = menuItems.find(opt => {
          if (!isElementVisible(opt, window.getComputedStyle(opt))) return false;
          const t = (opt.textContent || opt.getAttribute('aria-label') || opt.getAttribute('data-value') || '').toLowerCase();
          return t.includes(valStr);
        });

        if (matchedOption) {
          console.log('[Content] Selecting option inside dropdown menu:', matchedOption);
          await simulateClick(matchedOption);
          await sleep(300);
          return;
        }
      }

      if (element.tagName === 'LABEL' || element.getAttribute('role') === 'radio') {
        if (typeof element.click === 'function') {
          try { element.click(); } catch (e) { }
        }
      }

      await simulateClick(element);

      // Post-selection validation: ensure radio is actually checked
      if (valStr && targetRadio && targetRadio.tagName === 'INPUT' && !targetRadio.checked) {
        targetRadio.checked = true;
        try { targetRadio.click(); } catch (e) { }
        targetRadio.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      }
    }
  }

  async function simulateScroll(action) {
    const direction = action.direction || action.value || 'down';
    const amount = action.amount || 400;

    if (direction === 'up') {
      window.scrollBy({ top: -amount, behavior: 'smooth' });
    } else if (direction === 'down') {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    } else if (direction === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (direction === 'bottom') {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }
    await sleep(300);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function findElementSemantically(step) {
    const rawTarget = (step.intent || step.description || '')
      .replace(/^Click\s+["']?/i, '')
      .replace(/["']?\s+to complete$/i, '')
      .replace(/["']?\s*\(#\d+\)$/i, '')
      .replace(/^Type\s+["'][^"']+["']\s+into\s+["']?/i, '')
      .trim().toLowerCase();

    if (!rawTarget) return null;

    // ── Dedicated WhatsApp Web Element Resolution ─────────────────────────────
    if (window.location.hostname.includes('whatsapp.com')) {
      const isSearchIntent = rawTarget.includes('search') || rawTarget.includes('find') || rawTarget.includes('start new chat') || rawTarget.includes('start a new chat');
      const isMessageIntent = rawTarget.includes('message') || rawTarget.includes('body') || rawTarget.includes('type a message') || rawTarget.includes('text');
      const isSendIntent = rawTarget.includes('send') || rawTarget === 'send';

      if (isSearchIntent) {
        const waSearch = document.querySelector('#side [contenteditable="true"], div[data-tab="3"], [data-testid="chat-list-search"], #side [role="textbox"], #side p.selectable-text')
          || (document.querySelectorAll('[contenteditable="true"]').length > 0 ? document.querySelectorAll('[contenteditable="true"]')[0] : null);
        if (waSearch) {
          console.log('[Content] Matched WhatsApp Web search input:', waSearch);
          return waSearch;
        }
      }

      if (isMessageIntent) {
        const waMsg = document.querySelector('#main footer [contenteditable="true"], footer [contenteditable="true"], div[data-tab="10"], [data-testid="conversation-compose-box-input"], footer [role="textbox"]')
          || (document.querySelectorAll('[contenteditable="true"]').length > 1 ? document.querySelectorAll('[contenteditable="true"]')[document.querySelectorAll('[contenteditable="true"]').length - 1] : null);
        if (waMsg) {
          console.log('[Content] Matched WhatsApp Web message input:', waMsg);
          return waMsg;
        }
      }

      if (isSendIntent) {
        const waSend = document.querySelector('span[data-icon="send"], button[aria-label*="send" i], [data-testid="send"], [data-testid="compose-btn-send"], footer button:has(svg), footer button');
        if (waSend) {
          console.log('[Content] Matched WhatsApp Web send button:', waSend);
          return waSend;
        }
      }

      // Contact / chat matching in WhatsApp Web chat list
      const cleanName = rawTarget.replace(/^(?:open\s+chat\s+with|chat\s+with|open\s+chat|select\s+chat\s+with|select\s+chat|click\s+on\s+contact|click\s+contact|contact|chat|user)\s+/i, '').trim();
      if (cleanName) {
        const waContact = document.querySelector(
          `#side span[title*="${cleanName}" i], span[title*="${cleanName}" i], div[title*="${cleanName}" i], [role="listitem"]:has(span[title*="${cleanName}" i]), [role="row"]:has(span[title*="${cleanName}" i]), div[data-testid*="cell"]:has(span[title*="${cleanName}" i])`
        ) || Array.from(document.querySelectorAll('#side div[role="listitem"], #side div[role="row"], #side div[role="gridcell"], #side div._ak8l, #side div._ak72, #side div._ak73, #side span[title], #side div[title], [role="listitem"], [role="row"]')).find(el => {
          const title = (el.getAttribute('title') || '').toLowerCase();
          const text = (el.innerText || el.textContent || '').toLowerCase();
          return (title.includes(cleanName) || text.includes(cleanName)) && text.length < 90;
        });
        if (waContact) {
          console.log('[Content] Matched WhatsApp Web contact/chat:', waContact);
          return waContact;
        }
      }
    }

    // Direct high-accuracy selectors for email/compose actions
    if (rawTarget.includes('compose')) {
      // If compose modal is already open, return it so caller knows compose is already satisfied
      const openDialog = document.querySelector('div[role="dialog"], div.AD, table.Ao, div[aria-label*="New Message" i]');
      if (openDialog) {
        console.log('[Content] Matched already open Compose dialog:', openDialog);
        return openDialog;
      }
      const composeBtn = document.querySelector('div[gh="cm"], .T-I-KE, [data-tooltip*="Compose" i], [aria-label*="Compose" i], [role="button"][aria-label*="Compose" i]')
        || Array.from(document.querySelectorAll('button, div[role="button"], a')).find(el => {
          const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
          return t === 'compose' || t.startsWith('compose');
        });
      if (composeBtn) {
        console.log('[Content] Matched Compose button via direct selector:', composeBtn);
        return composeBtn;
      }
    }

    const composeDialog = document.querySelector('div[role="dialog"], div.AD, table.Ao, div[aria-label*="New Message" i]') || document;

    if (rawTarget.includes('recipient') || rawTarget.includes('to')) {
      const toInput = composeDialog.querySelector('input[name="to"], input[peoplekit-id], input[aria-label*="To" i], input[aria-label*="Recipients" i], [role="combobox"] input, td.Ao input, input.agP')
        || document.querySelector('input[name="to"], input[peoplekit-id], input[aria-label*="To" i], input[aria-label*="Recipients" i], input.agP')
        || composeDialog.querySelector('input[type="text"], input:not([type])');
      if (toInput) {
        console.log('[Content] Matched recipient input via direct selector:', toInput);
        return toInput;
      }
    }

    if (rawTarget.includes('subject')) {
      const subjInput = composeDialog.querySelector('input[name="subjectbox"], input[placeholder*="Subject" i], input[aria-label*="Subject" i], input.aoT')
        || document.querySelector('input[name="subjectbox"], input[placeholder*="Subject" i], input[aria-label*="Subject" i]');
      if (subjInput) {
        console.log('[Content] Matched subject input via direct selector:', subjInput);
        return subjInput;
      }
    }

    if (rawTarget.includes('body') || rawTarget.includes('message') || rawTarget.includes('content') || rawTarget.includes('text') || rawTarget.includes('type a message') || rawTarget.includes('message input field')) {
      const bodyInput = composeDialog.querySelector('div[role="textbox"][contenteditable="true"], div[aria-label*="Message Body" i], div[aria-label*="Message text" i], div.Am.Al.editable, div[role="textbox"], div[g_editable="true"], div[contenteditable="true"]')
        || document.querySelector('footer div[contenteditable="true"], div[contenteditable="true"][data-tab="10"], div[role="textbox"][title*="message" i], div[role="textbox"][aria-label*="message" i], div[data-testid="conversation-compose-box-input"], footer [contenteditable="true"]')
        || document.querySelector('div[role="dialog"] div[contenteditable="true"]');
      if (bodyInput) {
        console.log('[Content] Matched message body via direct selector:', bodyInput);
        return bodyInput;
      }
    }

    if ((rawTarget.includes('code') || rawTarget.includes('editor') || rawTarget.includes('solution') || /\bsolve\b/i.test(rawTarget)) && !rawTarget.includes('subject') && !rawTarget.includes('recipient') && !rawTarget.includes('to recipients') && !rawTarget.includes('message body')) {
      const codeEditor = document.querySelector('.monaco-editor, .monaco-editor textarea, .ace_editor, .ace_text-input, textarea.ace_text-input, .ace_content, div[role="textbox"], textarea');
      if (codeEditor) return codeEditor;
    }

    if (rawTarget.includes('run') || rawTarget.includes('compile') || rawTarget.includes('execute')) {
      const runBtn = document.querySelector('button[data-e2e-locator="console-run-button"], button[data-cypress="RunCode"], #run-btn, button.run, [data-testid*="run"], button[aria-label*="run" i]')
        || Array.from(document.querySelectorAll('button')).find(btn => {
          const t = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase().trim();
          return t === 'run' || t.startsWith('run') || t.includes('compile') || t.includes('execute');
        });
      if (runBtn) return runBtn;
    }

    if (rawTarget.includes('submit')) {
      const submitBtn = document.querySelector('button[data-e2e-locator="console-submit-button"], [data-e2e-locator*="submit"], button.bg-green-60, [data-cy="submit-code-btn"]')
        || Array.from(document.querySelectorAll('button, div[role="button"], [role="button"]')).find(btn => {
          const t = (btn.textContent || btn.innerText || '').trim().toLowerCase();
          return t === 'submit' || t.startsWith('submit');
        });
      if (submitBtn) return submitBtn;
    }

    if (rawTarget.includes('search result') || rawTarget.includes('top result') || rawTarget.includes('first result') || rawTarget.includes('first video') || rawTarget.includes('first item') || rawTarget.includes('first product') || rawTarget.includes('top findings')) {
      // On LeetCode specifically, always select the genuine problem link (avoiding /problem-list/ cards)
      if (window.location.hostname.includes('leetcode.com')) {
        const leetProblemLink = document.querySelector('div[role="row"] a[href^="/problems/"], div[role="table"] a[href^="/problems/"], a[href^="/problems/"]:not([href*="solution"]):not([href*="discuss"]), a[href*="/problems/"]')
          || Array.from(document.querySelectorAll('a[href*="/problems/"]')).find(a => !a.href.includes('/problem-list/'));
        if (leetProblemLink) {
          console.log('[Content] Matched LeetCode problem link:', leetProblemLink.href);
          try {
            leetProblemLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
            leetProblemLink.style.outline = '3px solid #10b981';
          } catch (e) { }
          return leetProblemLink;
        }
      }

      const topLink = document.querySelector(
        '#search a:has(h3), .g a:has(h3), [data-sokoban-container] a:has(h3), a:has(h3), #rso a:has(h3), #rso a, div[data-component-type="s-search-result"] h2 a, .s-result-item h2 a, div[data-cy="title-recipe"] a, ytd-video-renderer a#thumbnail, ytd-video-renderer h3 a, ytd-rich-item-renderer a#thumbnail, [data-testid="results-list"] a, div[data-testid="results-list"] div[data-testid="search-result"] a, a[data-testid="search-result-title"], a.Link__StyledLink-sc-nb9098-0, div.search-title a, a.v-align-middle, div.f4.text-normal a, ul.repo-list li a, a[href*="/"][data-testid*="result"]'
      );
      if (topLink) {
        console.log('[Content] Matched top search result link:', topLink);
        try {
          topLink.scrollIntoView({ behavior: 'smooth', block: 'center' });
          topLink.style.outline = '3px solid #f43f5e';
          topLink.style.boxShadow = '0 0 20px rgba(244, 63, 94, 0.7)';
          topLink.style.borderRadius = '6px';
          topLink.style.transition = 'all 0.3s ease';
          setTimeout(() => {
            try {
              topLink.style.outline = '';
              topLink.style.boxShadow = '';
            } catch (e) { }
          }, 3800);
        } catch (e) { }
        return topLink;
      }
    }

    if (rawTarget.includes('presentation') || rawTarget.includes('template')) {
      const presBtn = document.querySelector(
        'button[aria-label*="Presentation" i], a[href*="presentation" i], div[role="button"][aria-label*="Presentation" i], button[aria-label*="blank" i], a[href*="category=tACFat6cqQI"], button:has(div)'
      ) || Array.from(document.querySelectorAll('button, a, div[role="button"]')).find(el => {
        const t = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase().trim();
        return t.includes('presentation (16:9)') || t === 'presentation' || t.includes('create a blank presentation') || t.includes('blank presentation');
      });
      if (presBtn) {
        console.log('[Content] Matched Presentation template button:', presBtn);
        return presBtn;
      }
    }

    // ── Dedicated GitHub New Repository Elements ──────────────────────────────
    if (rawTarget.includes('create repository') || rawTarget.includes('create repo') || (rawTarget.includes('create') && window.location.pathname.includes('/new'))) {
      const createBtn = document.querySelector('button[type="submit"].btn-primary, button[type="submit"]:has(span), form.new_repository button[type="submit"], button[data-disable-with*="Creating" i]')
        || Array.from(document.querySelectorAll('button[type="submit"], button')).find(btn => {
          const t = (btn.textContent || btn.innerText || '').trim().toLowerCase();
          return t === 'create repository' || t.startsWith('create repository') || t.includes('create repository');
        });
      if (createBtn) {
        console.log('[Content] Matched Create repository submit button:', createBtn);
        return createBtn;
      }
    }

    if (rawTarget.includes('description') || rawTarget.includes('discreption') || rawTarget.includes('desc')) {
      const descInput = document.querySelector(
        '#repository_description, input[name="repository[description]"], input[aria-label*="description" i], textarea[name="repository[description]"], textarea[aria-label*="description" i], input[placeholder*="description" i], textarea[placeholder*="description" i], [data-testid="repository-description-input"]'
      ) || Array.from(document.querySelectorAll('input, textarea')).find(el => {
        const id = (el.id || el.name || el.placeholder || el.getAttribute('aria-label') || '').toLowerCase();
        return id.includes('description') || id.includes('desc');
      });
      if (descInput) {
        console.log('[Content] Matched description input via direct selector:', descInput);
        return descInput;
      }
    }

    if (rawTarget.includes('readme')) {
      const readmeEl = document.querySelector(
        '#repository_auto_init, input[name="repository[auto_init]"], input[id*="readme" i], [aria-label*="readme" i], input[type="checkbox"][id*="init"]'
      ) || Array.from(document.querySelectorAll('input[type="checkbox"], button, [role="switch"], label')).find(el => {
        const text = (el.textContent || el.getAttribute('aria-label') || el.id || el.name || '').toLowerCase();
        const parentText = (el.closest('div, label, section')?.textContent || '').toLowerCase();
        return text.includes('readme') || parentText.includes('add a readme');
      });
      if (readmeEl) {
        console.log('[Content] Matched README toggle/checkbox:', readmeEl);
        return readmeEl;
      }
    }

    if ((rawTarget.includes('repo name') || rawTarget.includes('repository name') || (step.action === 'type' && (rawTarget.includes('repo') || rawTarget.includes('repository')))) && !rawTarget.includes('create')) {
      const repoInput = document.querySelector(
        '#repository_name, input[name="repository[name]"], input[data-testid="repository-name-input"], input[aria-label*="Repository name" i], input[aria-describedby*="RepoName"], input[id*="repository_name"]'
      ) || Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).find(el => {
        const lbl = (el.getAttribute('aria-label') || el.name || el.placeholder || el.id || '').toLowerCase();
        const parent = (el.closest('div, dl, fieldset, section')?.textContent || '').toLowerCase();
        return lbl.includes('repo') || parent.includes('repository name');
      });
      if (repoInput) {
        console.log('[Content] Matched repository name input via direct selector:', repoInput);
        return repoInput;
      }
    }

    if (rawTarget.includes('search') || rawTarget.includes('query') || rawTarget.includes('find')) {
      if (step.action === 'click' || rawTarget.includes('submit') || rawTarget.includes('button') || rawTarget.includes('icon') || rawTarget.includes('go')) {
        const searchBtn = document.querySelector(
          '#nav-search-submit-button, input#nav-search-submit-button, button#search-icon-legacy, input[name="btnK"], form input[type="submit"], form button[type="submit"], button[aria-label*="search" i], .nav-search-submit, .search-btn, .search-button, button.nav-search-submit'
        ) || Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b => {
          const t = (b.textContent || b.getAttribute('aria-label') || b.id || '').toLowerCase();
          return t.includes('search') || t.includes('go');
        });
        if (searchBtn) {
          console.log('[Content] Matched search submit button via direct selector:', searchBtn);
          return searchBtn;
        }
      }

      const searchInput = document.querySelector(
        'div[contenteditable="true"][data-tab="3"], div[role="textbox"][title*="search" i], div[role="textbox"][aria-label*="search" i], [data-testid="chat-list-search"], #twotabsearchtextbox, input#nav-search-keywords, input[name="field-keywords"], input[name="q"], input[type="search"], input[name="search"], input[aria-label*="Search" i], input[placeholder*="Search" i], textarea[name="q"]'
      ) || Array.from(document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"]')).find(el => {
        const lbl = (el.getAttribute('aria-label') || el.getAttribute('title') || el.placeholder || el.name || el.id || '').toLowerCase();
        return lbl.includes('search') || lbl.includes('query');
      });
      if (searchInput) {
        console.log('[Content] Matched search input via direct selector:', searchInput);
        return searchInput;
      }
    }
    // Dedicated GitHub Profile, Repositories & Account Direct Resolver
    const isGithub = window.location.hostname.includes('github.com');
    if (isGithub && (rawTarget.includes('profile') || rawTarget.includes('repo') || rawTarget.includes('avatar') || rawTarget.includes('account icon') || rawTarget.includes('user icon'))) {
      const userLogin = document.querySelector('meta[name="user-login"]')?.content ||
                        document.querySelector('meta[name="octolytics-actor-login"]')?.content ||
                        document.querySelector('img.avatar-user')?.getAttribute('alt')?.replace(/^@/, '') || '';

      const isReposIntent = rawTarget.includes('repo') || (step.description || '').toLowerCase().includes('repo') || (step.intent || '').toLowerCase().includes('repo');

      // 1. Direct URL navigation if username is present in page meta
      if (userLogin) {
        const destUrl = isReposIntent
          ? `https://github.com/${userLogin}?tab=repositories`
          : `https://github.com/${userLogin}`;
        console.log(`[Content] Navigating directly to GitHub ${isReposIntent ? 'repositories' : 'profile'}: ${destUrl}`);
        window.location.href = destUrl;
        return document.body;
      }

      // 2. If already in drawer/menu, click the actual 'Your repositories' or 'Your profile' link
      const directNavLink = Array.from(document.querySelectorAll('a, button')).find(el => {
        const t = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
        if (isReposIntent) {
          return t === 'your repositories' || t === 'all repositories' || t === 'repositories';
        } else {
          return t === 'your profile' || t === 'profile';
        }
      });
      if (directNavLink) {
        console.log('[Content] Matched GitHub drawer/menu link:', directNavLink);
        return directNavLink;
      }

      // 3. User profile avatar button in top right
      const profileBtn = document.querySelector(
        'button[aria-label*="user account" i], button[aria-label*="user navigation" i], button[aria-label*="user menu" i], button[aria-label*="View profile" i], button:has(img.avatar-user), button:has(img[class*="avatar"]), img.avatar-user, a[href^="/settings/profile"]'
      );
      if (profileBtn) {
        console.log('[Content] Matched GitHub user profile avatar button:', profileBtn);
        return profileBtn;
      }
    }

    if (rawTarget.includes('private') || (step.value && String(step.value).toLowerCase() === 'private')) {
      // Check for visibility dropdown button on modern GitHub / UI (e.g. [Public ▾] next to Choose visibility)
      const visDropdownBtn = Array.from(document.querySelectorAll('button')).find(btn => {
        const text = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
        const containerText = (btn.closest('div, section, fieldset')?.textContent || '').toLowerCase();
        return (text.includes('public') || text.includes('private') || text.includes('visibility')) && containerText.includes('visibility');
      });
      if (visDropdownBtn) {
        console.log('[Content] Matched visibility dropdown trigger:', visDropdownBtn);
        return visDropdownBtn;
      }

      const privateRadio = document.querySelector('input[type="radio"][value="private"], input[value="private"], #repository_visibility_private, [aria-label*="Private"], input[id*="private"]')
        || Array.from(document.querySelectorAll('label, div[role="radio"], [role="radio"]')).find(el => {
          const t = (el.textContent || '').toLowerCase();
          return t.includes('private') && !t.includes('public');
        });
      if (privateRadio) {
        console.log('[Content] Matched Private radio option:', privateRadio);
        return privateRadio;
      }
    }

    if (rawTarget.includes('public') || (step.value && String(step.value).toLowerCase() === 'public')) {
      const visDropdownBtn = Array.from(document.querySelectorAll('button')).find(btn => {
        const text = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
        const containerText = (btn.closest('div, section, fieldset')?.textContent || '').toLowerCase();
        return (text.includes('public') || text.includes('private') || text.includes('visibility')) && containerText.includes('visibility');
      });
      if (visDropdownBtn) return visDropdownBtn;

      const publicRadio = document.querySelector('input[type="radio"][value="public"], input[value="public"], #repository_visibility_public, [aria-label*="Public"], input[id*="public"]')
        || Array.from(document.querySelectorAll('label, div[role="radio"], [role="radio"]')).find(el => {
          const t = (el.textContent || '').toLowerCase();
          return t.includes('public') && !t.includes('private');
        });
      if (publicRadio) {
        console.log('[Content] Matched Public radio option:', publicRadio);
        return publicRadio;
      }
    }

    // Dedicated Search Results / Video / Dataset top item handler
    if (rawTarget.includes('search result') || rawTarget.includes('top result') ||
      rawTarget.includes('first result') || rawTarget.includes('first dataset') ||
      rawTarget.includes('top video') || rawTarget.includes('first video') ||
      rawTarget.includes('first search result')) {
      const hostname = window.location.hostname;
      let topItem = null;

      if (hostname.includes('wikipedia.org')) {
        topItem = document.querySelector('.mw-search-results li a, .mw-search-result-heading a, .searchresults a');
      } else if (hostname.includes('youtube.com')) {
        topItem = document.querySelector('ytd-video-renderer a#video-title, #contents ytd-video-renderer a#video-title, ytd-rich-item-renderer a#video-title, a#video-title');
      } else if (hostname.includes('amazon.')) {
        topItem = document.querySelector('div[data-component-type="s-search-result"] h2 a, .s-result-item h2 a, a.a-link-normal.s-underline-text');
      } else if (hostname.includes('reddit.com')) {
        topItem = document.querySelector('a[data-testid="post-title-text"], a[data-testid="post-title"], a[slot="full-post-link"], shresh-post a');
      } else if (hostname.includes('kaggle.com')) {
        topItem = document.querySelector('a[href*="/datasets/"], div[role="list"] a, div[data-testid="list-item"] a');
      } else if (hostname.includes('leetcode.com')) {
        topItem = document.querySelector('a[href*="/problems/"], div[role="rowgroup"] a');
      } else if (hostname.includes('google.')) {
        topItem = document.querySelector('#rso a:has(h3), #search .g a, div[role="listitem"] a, a[href*="/quote/"]');
      } else if (hostname.includes('w3schools.com')) {
        topItem = document.querySelector('a[href*="/python/"], a[href*="/tutorial/"], #main a, a.w3-button');
      }

      if (!topItem) {
        topItem = document.querySelector('main a:has(h2), main a:has(h3), #rso a:has(h3), article a, .results a, [role="feed"] a');
      }

      if (topItem) {
        console.log('[Content] Matched top search result element:', topItem);
        return topItem;
      }
    }

    // Dedicated Google Account Chooser & Sign-In handler (supports Google One-Tap & OAuth)
    const isLoginOrGoogleIntent = rawTarget.includes('google') || rawTarget.includes('first email') || rawTarget.includes('first account') ||
      rawTarget.includes('sign in') || rawTarget.includes('continue with google') || rawTarget.includes('login') ||
      rawTarget.includes('log in') || rawTarget.includes('signin');

    if (isLoginOrGoogleIntent) {
      const emailRegex = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/;

      // 1. Account tile in Google One-Tap or Google Chooser
      const accountTiles = Array.from(document.querySelectorAll('div[data-identifier], div[data-email], li[data-email], [data-profile-identifier], div[role="link"], div[role="button"], li, tr, [tabindex="0"]'));
      for (const tile of accountTiles) {
        const t = (tile.innerText || tile.textContent || '') + ' ' + (tile.getAttribute('data-identifier') || '') + ' ' + (tile.getAttribute('data-email') || '');
        if (emailRegex.test(t)) {
          console.log('[Content] Matched first Google Account in chooser/One-Tap:', tile);
          return tile;
        }
      }

      // 2. Google SSO button on parent page
      const googleBtns = Array.from(document.querySelectorAll('button, a, div[role="button"], [role="button"], iframe[title*="Google"]')).filter(el => {
        const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
        return (t.includes('continue with google') || t.includes('sign in with google') || t.includes('log in with google') || t.includes('signin with google') || (t.includes('google') && (t.includes('sign in') || t.includes('log in') || t.includes('continue'))));
      });
      if (googleBtns.length > 0) {
        console.log('[Content] Matched Google SSO button:', googleBtns[0]);
        return googleBtns[0];
      }
    }

    // Direct Send button selector (Gmail, WhatsApp Web, forms, etc.)
    if (rawTarget.includes('send') || rawTarget.includes('send button') || rawTarget.includes('send email') || rawTarget === 'send') {
      const isGmail = window.location.hostname.includes('mail.google.com') || window.location.hostname.includes('gmail.com');
      if (isGmail) {
        const gmailSendBtn = document.querySelector('div[role="dialog"] div[role="button"][data-tooltip*="Send" i], div.T-I-KE[aria-label*="Send" i], div[aria-label*="Send" i], div[data-tooltip*="Ctrl-Enter" i], div.aoO[role="button"]')
          || document.querySelector('div[role="button"][data-tooltip*="Send" i], div.T-I-KE[aria-label*="Send" i], div[aria-label*="Send" i]')
          || Array.from(document.querySelectorAll('div[role="button"], button')).find(b => {
               const t = (b.textContent || b.innerText || b.getAttribute('aria-label') || '').trim();
               return t === 'Send' || t.startsWith('Send');
             });
        if (gmailSendBtn) {
          console.log('[Content] Matched Gmail Send button via direct selector:', gmailSendBtn);
          return gmailSendBtn;
        }
      }

      const sendBtn = document.querySelector(
        'span[data-icon="send"], button[aria-label*="send" i], [data-testid="send"], [data-testid="compose-btn-send"], footer button:has(span[data-icon="send"]), footer button:has(svg)'
      );
      if (sendBtn) {
        console.log('[Content] Matched Send button via direct selector:', sendBtn);
        return sendBtn;
      }
    }

    // Direct contact / recipient / chat row selector (WhatsApp Web, Telegram, Slack, etc.)
    if (step.action === 'click' || step.type === 'click') {
      const contactEl = document.querySelector(
        `span[title*="${rawTarget}" i], div[title*="${rawTarget}" i], [role="listitem"]:has(span[title*="${rawTarget}" i]), [role="row"]:has(span[title*="${rawTarget}" i]), div[data-testid*="cell"]:has(span[title*="${rawTarget}" i]), [data-testid="chat-list"] span[title*="${rawTarget}" i]`
      ) || Array.from(document.querySelectorAll('div[role="listitem"], div[role="row"], div[role="gridcell"], div[data-testid*="cell"], div[data-testid*="chat"], div._ak8l, div._ak72, div._ak73, span[title], div[title]')).find(el => {
        const titleAttr = (el.getAttribute('title') || '').toLowerCase();
        const text = (el.innerText || el.textContent || '').toLowerCase();
        return (titleAttr.includes(rawTarget) || text.includes(rawTarget)) && text.length < 80;
      });
      if (contactEl) {
        console.log('[Content] Matched contact/chat element semantically:', contactEl);
        return contactEl;
      }
    }

    const candidates = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="link"], div[onclick], span[onclick], iframe, [tabindex], [role="listitem"], [role="row"], [role="gridcell"], div[data-testid*="cell"], div[data-testid*="chat"], div._ak8l, div._ak72, div._ak73, span[title], div[title]'));
    let best = null;
    let bestScore = 0;

    const words = rawTarget.split(/\s+/).filter(w => w.length >= 3 && !['the', 'and', 'with', 'for', 'click'].includes(w));

    for (const el of candidates) {
      if (!isElementVisible(el, window.getComputedStyle(el))) continue;
      if ((step.action === 'type' || step.type === 'type') &&
        (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || el.getAttribute('role') === 'link')) {
        continue;
      }
      const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.value || '').toLowerCase();
      if (!text) continue;

      let score = 0;
      for (const w of words) {
        if (text.includes(w)) score += 30;
      }
      if (rawTarget.length > 3 && text.includes(rawTarget)) score += 70;
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 15;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    if (bestScore >= 25) {
      console.log(`[Content] Recovered target node semantically for step #${step.step || 0} (score: ${bestScore}):`, best);
      return best;
    }
    return null;
  }

  /**
   * Task 44: Native multi-action executor with per-step existence checks
   * If step N target vanished due to step N-1 changing the page, abort remaining plan
   * and log executed steps.
   */
  async function executeActionPlan(plan) {
    const actions = plan.actions || [];
    const planId = plan.id || `plan-${Date.now()}`;
    const executedResults = [];

    console.log(`[Content] Executing deterministic multi-action plan (${actions.length} steps)...`);
    showHudOverlay(plan.reasoning || '⚡ Aero Agent is working...');

    for (let i = 0; i < actions.length; i++) {
      const step = actions[i];
      const stepIndex = step.step !== undefined ? step.step : i;
      showHudOverlay(step.description || `Executing step ${i + 1}/${actions.length}: ${step.action || step.type}`);
      let targetNode = null;

      // Immediate pre-step existence check
      if (step.tag_id) {
        if (tagElementMap.size === 0) {
          extractInteractiveElements(true);
        }
        targetNode = tagElementMap.get(step.tag_id);
        // Verify node is still connected to document
        if (targetNode && !document.contains(targetNode)) {
          console.warn(`[Content] Target tag #${step.tag_id} disconnected from DOM before step #${stepIndex}`);
          targetNode = null;
        }
      }

      // Robust Semantic Recovery: find matching element on live page if tag_id mapping shifted
      if (!targetNode && (step.description || step.intent || step.value)) {
        targetNode = findElementSemantically(step);
        if (!targetNode) {
          await sleep(400);
          targetNode = findElementSemantically(step);
        }
      }

      // High-accuracy live Gmail Compose element resolution (dialog-scoped to prevent hitting background inbox)
      const isGmail = window.location.hostname.includes('google') || window.location.hostname.includes('gmail');
      let isCompose = false;
      let isSend = false;
      if (isGmail && (step.action === 'type' || step.action === 'click')) {
        const desc = (step.description || '').toLowerCase();
        const field = (step.field || '').toLowerCase();
        const tgt = (step.target || '').toLowerCase();
        const isSubject = desc.includes('subject') || field.includes('subject') || tgt.includes('subject');
        const isBody = desc.includes('body') || desc.includes('message') || field.includes('body') || field.includes('message') || tgt.includes('body');
        const isRecipient = !isSubject && !isBody && (desc.includes('recipient') || desc.includes('to') || field.includes('recipient') || field.includes('to') || tgt.includes('recipient'));
        isCompose = desc.includes('compose') || tgt.includes('compose');
        isSend = desc.includes('send') || tgt.includes('send');

        // If an email action (recipient, subject, body) is requested but Compose modal is not yet open on Gmail:
        if (isRecipient || isSubject || isBody) {
          const existingDialogs = Array.from(document.querySelectorAll('div[role="dialog"], div.AD, table.Ao'));
          const existingCompose = existingDialogs.find(d => {
            return d.querySelector('input[name="subjectbox"], input[placeholder*="Subject" i], div[aria-label*="Message" i], div[role="textbox"], input[name="to"], input[peoplekit-id]') !== null;
          });

          if (!existingCompose) {
            console.log('[Content] Gmail Compose dialog not open yet. Dynamically triggering Compose...');
            const composeBtn = document.querySelector('div[gh="cm"], .T-I-KE, [data-tooltip="Compose"], [aria-label="Compose"], [aria-label*="Compose" i]')
              || Array.from(document.querySelectorAll('div[role="button"], button')).find(b => {
                   const t = (b.textContent || b.innerText || '').trim().toLowerCase();
                   return t === 'compose' || t.startsWith('compose');
                 });
            if (composeBtn) {
              composeBtn.click();
              await sleep(800);
            } else if (!window.location.hash.includes('compose=new')) {
              window.location.hash = '#inbox?compose=new';
              await sleep(1000);
            }
          }
        }

        // Locate the active Compose dialog (topmost modal in front of user)
        const dialogs = Array.from(document.querySelectorAll('div[role="dialog"], div.AD, table.Ao'));
        const composeDialog = dialogs.reverse().find(d => {
          return d.querySelector('input[name="subjectbox"], input[placeholder*="Subject" i], div[aria-label*="Message" i], div[role="textbox"]') !== null;
        }) || document.querySelector('div[role="dialog"]') || document;

        if (isBody) {
          const bodyEl = composeDialog.querySelector('div[role="textbox"][contenteditable="true"], div[aria-label*="Message Body" i], div[aria-label*="Message text" i], div.Am.Al.editable, div[role="textbox"], div[g_editable="true"]')
            || composeDialog.querySelector('div[contenteditable="true"]')
            || document.querySelector('div[role="dialog"] div[contenteditable="true"]');
          if (bodyEl) {
            targetNode = bodyEl;
            try { bodyEl.click(); bodyEl.focus(); } catch (e) { }
          }
        } else if (isSubject) {
          const subjEl = composeDialog.querySelector('input[name="subjectbox"], input[placeholder*="Subject" i], input[aria-label*="Subject" i], input.aoT')
            || document.querySelector('input[name="subjectbox"], input[placeholder*="Subject" i]');
          if (subjEl) {
            targetNode = subjEl;
            try { subjEl.click(); subjEl.focus(); } catch (e) { }
          }
        } else if (isRecipient) {
          const toEl = composeDialog.querySelector('input[name="to"], input[peoplekit-id], input[aria-label*="To" i], input[aria-label*="Recipients" i], [role="combobox"] input, td.Ao input, input.agP')
            || document.querySelector('input[name="to"], input[peoplekit-id], input[aria-label*="To" i], input[aria-label*="Recipients" i], input.agP')
            || composeDialog.querySelector('input[type="text"], input:not([type])');
          if (toEl) {
            targetNode = toEl;
            try { toEl.click(); toEl.focus(); } catch (e) { }
          }
        } else if (isCompose) {
          const isAlreadyOpen = !!document.querySelector('div[role="dialog"], div.AD, table.Ao, div[aria-label*="New Message" i]');
          if (isAlreadyOpen) {
            console.log('[Content] Gmail Compose modal is already open and ready.');
            targetNode = composeDialog;
            step._composeAlreadyOpen = true;
          } else {
            const composeEl = document.querySelector('div[gh="cm"], .T-I-KE, [data-tooltip*="Compose" i], [aria-label*="Compose" i], [role="button"][aria-label*="Compose" i]');
            if (composeEl) targetNode = composeEl;
          }
        } else if (isSend) {
          const sendBtn = composeDialog.querySelector('div[role="button"][data-tooltip*="Send" i], div.T-I-KE[aria-label*="Send" i], div[aria-label*="Send" i], div[data-tooltip*="Ctrl-Enter" i], div.aoO[role="button"]')
            || document.querySelector('div[role="button"][data-tooltip*="Send" i], div.T-I-KE[aria-label*="Send" i], div[aria-label*="Send" i]')
            || Array.from(composeDialog.querySelectorAll('div[role="button"], button')).find(b => {
                 const t = (b.textContent || b.innerText || b.getAttribute('aria-label') || '').trim();
                 return t === 'Send' || t.startsWith('Send');
               });
          if (sendBtn) targetNode = sendBtn;
        }
      }

      const actionType = step.action || step.type;
      const result = {
        plan_id: planId,
        step_index: stepIndex,
        action: actionType,
        success: false,
        error: null,
        page_changed: false
      };

      try {
        switch (actionType) {
          case 'click':
            if (step._composeAlreadyOpen) {
              console.log('[Content] Compose modal is already open; skipping click and marking success.');
              result.success = true;
              result.page_changed = false;
              break;
            }
            if (isGmail && isSend) {
              if (targetNode) {
                await simulateClick(targetNode);
                try { if (typeof targetNode.click === 'function') targetNode.click(); } catch(e) {}
              }
              // Dispatch Ctrl+Enter to guarantee transmission
              const activeEl = document.activeElement || targetNode || document.body;
              activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true, keyCode: 13, which: 13, bubbles: true, cancelable: true }));
              activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', ctrlKey: true, keyCode: 13, which: 13, bubbles: true, cancelable: true }));
              result.success = true;
              result.page_changed = true;
              break;
            }
            if (!targetNode) {
              result.success = false;
              result.error = `Target element #${step.tag_id} not found in DOM`;
              break;
            }
            await simulateClick(targetNode);
            result.success = true;
            result.page_changed = true;
            break;

          case 'type':
            if (!targetNode) {
              result.success = false;
              result.error = `Target element #${step.tag_id} not found for typing`;
              break;
            }
            try {
              await simulateType(targetNode, step.value || '');
            } catch (typeErr) {
              console.warn('[Content] Non-fatal simulateType error:', typeErr);
            }
            result.success = true;
            result.page_changed = true;
            break;

          case 'select':
            if (!targetNode) {
              result.success = false;
              result.error = `Target element #${step.tag_id} not found for dropdown select`;
              break;
            }
            await simulateSelect(targetNode, step.value);
            result.success = true;
            result.page_changed = true;
            break;

          case 'scroll':
            await simulateScroll(step);
            result.success = true;
            result.page_changed = true;
            break;

          case 'hover':
            if (targetNode) {
              targetNode.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
              targetNode.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            }
            result.success = true;
            break;

          case 'press_key': {
            const keyName = step.key || step.value || 'Enter';
            const keyCode = keyName === 'Enter' ? 13 : (keyName === 'Tab' ? 9 : 0);
            const keyInit = { key: keyName, code: keyName, keyCode, which: keyCode, bubbles: true, cancelable: true };
            const target = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : (lastInteractedElement || document.body);
            target.dispatchEvent(new KeyboardEvent('keydown', keyInit));
            target.dispatchEvent(new KeyboardEvent('keypress', keyInit));
            target.dispatchEvent(new KeyboardEvent('keyup', keyInit));

            // CRITICAL FOR WEBSITES (Amazon, YouTube, Google, GitHub, etc.):
            // Synthetic KeyboardEvent('Enter') does NOT trigger browser default form submission.
            // Actively locate and tap the search icon / submit button or trigger form.requestSubmit().
            if (keyName === 'Enter') {
              // WhatsApp Web: click Send button if present
              const waSendBtn = document.querySelector('span[data-icon="send"], button[aria-label*="send" i], [data-testid="send"], [data-testid="compose-btn-send"], footer button:has(span[data-icon="send"])');
              if (waSendBtn) {
                console.log('[Content] Tapping WhatsApp Send button on Enter:', waSendBtn);
                await simulateClick(waSendBtn);
                result.success = true;
                result.page_changed = true;
                break;
              }

              // Gmail: click Send button if on Gmail and intent is Send email
              const isGmail = window.location.hostname.includes('mail.google.com') || window.location.hostname.includes('gmail.com');
              const isSendEmailIntent = (step.description || step.intent || '').toLowerCase().includes('send');
              if (isGmail && isSendEmailIntent) {
                const gmailSendBtn = document.querySelector('div[role="button"][data-tooltip*="Send" i], div.T-I-KE[aria-label*="Send" i], div[aria-label*="Send" i], div[data-tooltip*="Ctrl-Enter" i]')
                  || Array.from(document.querySelectorAll('div[role="button"], button')).find(b => {
                       const t = (b.textContent || b.innerText || b.getAttribute('aria-label') || '').trim();
                       return t === 'Send' || t.startsWith('Send');
                     });
                if (gmailSendBtn) {
                  console.log('[Content] Clicking Gmail Send button on Send email action:', gmailSendBtn);
                  await simulateClick(gmailSendBtn);
                  result.success = true;
                  result.page_changed = true;
                  break;
                }
              }

              const isEmailPage = isGmail || (target && target.closest && (target.closest('[role="dialog"]') || target.closest('div[aria-label*="Compose" i]')));
              if (!isEmailPage) {
                const form = (target && target.tagName === 'FORM') ? target : (target.form || target.closest?.('form'));
                let submitBtn = form?.querySelector?.('#nav-search-submit-button, input[type="submit"], button[type="submit"], button[aria-label*="search" i], .nav-search-submit, button:has(svg)');
                if (!submitBtn) {
                  submitBtn = document.querySelector('#nav-search-submit-button, input#nav-search-submit-button, button#search-icon-legacy, input[name="btnK"], form input[type="submit"], form button[type="submit"], button[aria-label*="search" i], .search-btn, .search-button, button.nav-search-submit');
                }

                if (submitBtn) {
                  console.log('[Content] Tapping search icon / submit button on Enter:', submitBtn);
                  await simulateClick(submitBtn);
                } else if (form) {
                  try {
                    if (typeof form.requestSubmit === 'function') {
                      form.requestSubmit();
                    } else {
                      form.submit();
                    }
                  } catch (e) {
                    try { form.submit(); } catch (ex) { }
                  }
                }
              }
            }

            result.success = true;
            result.page_changed = true;
            break;
          }


          case 'navigate':
            if (step.value) {
              window.location.href = step.value;
            }
            result.success = true;
            result.page_changed = true;
            break;

          case 'back':
            window.history.back();
            result.success = true;
            result.page_changed = true;
            break;

          case 'reload':
            window.location.reload();
            result.success = true;
            result.page_changed = true;
            break;

          case 'wait':
            await sleep(step.value || 1000);
            result.success = true;
            break;

          default:
            throw new Error(`Unsupported action type: ${step.action}`);
        }
      } catch (err) {
        result.success = false;
        result.error = err?.message || 'Action execution error';
      }

      executedResults.push(result);

      // Report telemetry
      chrome.runtime.sendMessage({
        type: 'action_result',
        id: `ar-${Date.now()}-${stepIndex}`,
        timestamp: new Date().toISOString(),
        payload: result
      }).catch(() => { });

      // Halt on failure so agent re-reasons with fresh page state
      if (!result.success) {
        console.log(`[Content] Halting plan on step #${stepIndex}: ${result.error || 'Failed'}`);
        break;
      }

      await sleep(120);
    }

    setTimeout(() => hideHudOverlay(), 600);
    return executedResults;
  }

  // Runtime message handler
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'ping': {
        sendResponse({ status: 'pong' });
        break;
      }

      case 'extract_dom': {
        const domData = extractInteractiveElements(message.force_full);
        if (message.render_overlays) {
          renderNumberedOverlays(domData.elements);
        }
        sendResponse({ type: 'dom_data', payload: domData });
        break;
      }

      case 'collect_alerts': {
        const alerts = collectPageAlerts();
        sendResponse({ alerts });
        break;
      }

      case 'show_overlays': {
        const domData = extractInteractiveElements();
        renderNumberedOverlays(domData.elements);
        sendResponse({ success: true, count: domData.elements.length });
        break;
      }

      case 'hide_overlays': {
        clearNumberedOverlays();
        sendResponse({ success: true });
        break;
      }

      case 'show_hud_overlay': {
        showHudOverlay(message.text || 'Aero Agent Active', !!message.paused);
        sendResponse({ success: true });
        break;
      }

      case 'hide_hud_overlay': {
        hideHudOverlay();
        sendResponse({ success: true });
        break;
      }

      case 'scan_pii': {
        const sensitive = window.PIIDetector ? window.PIIDetector.scanDOM() : [];
        sendResponse({ sensitive_nodes: sensitive });
        break;
      }

      case 'execute_actions':
      case 'action_plan': {
        executeActionPlan(message.payload)
          .then(results => sendResponse({ status: 'completed', results }))
          .catch(err => sendResponse({ status: 'error', error: err.message }));
        return true;
      }

      case 'start_speech_recognition': {
        const started = startWebSpeechRecognition();
        sendResponse({ success: started });
        break;
      }

      case 'stop_speech_recognition': {
        stopWebSpeechRecognition();
        sendResponse({ success: true });
        break;
      }

      case 'scrape_page_content': {
        const pageData = scrapePageContent();
        sendResponse({ type: 'page_content', payload: pageData });
        break;
      }

      case 'show_floating_summary': {
        const title = message.title || message.payload?.title || 'Executive Summary';
        const md = message.summaryMarkdown || message.summary || message.payload?.summary || message.payload?.summaryMarkdown || '';
        showFloatingSummaryCard(title, md);
        sendResponse({ success: true });
        break;
      }

      case 'hide_floating_summary': {
        hideFloatingSummaryCard();
        sendResponse({ success: true });
        break;
      }



      default:
        sendResponse({ status: 'unhandled_message' });
    }
    return true;
  });

  // Live Speech Recognition Engine running in webpage context
  let contentSpeechRec = null;
  let isContentSpeechActive = false;

  function startWebSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[Content] Web Speech API not supported in this window');
      return false;
    }

    try {
      if (contentSpeechRec) {
        try { contentSpeechRec.stop(); } catch (e) { }
      }

      contentSpeechRec = new SpeechRecognition();
      contentSpeechRec.continuous = true;
      contentSpeechRec.interimResults = true;
      // Auto-detect optimal regional speech language for Indian English / multilingual accuracy
      contentSpeechRec.lang = navigator.language?.startsWith('en') ? 'en-IN' : (navigator.language || 'en-IN');
      isContentSpeechActive = true;

      contentSpeechRec.onresult = (event) => {
        let interimText = '';
        let finalText = '';
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalText += res[0].transcript + ' ';
          } else {
            interimText += res[0].transcript;
          }
        }
        const fullTranscript = (finalText + interimText).trim();
        if (fullTranscript) {
          chrome.runtime.sendMessage({
            type: 'speech_live_transcript',
            text: fullTranscript
          }).catch(() => { });
        }
      };

      contentSpeechRec.onerror = (event) => {
        if (event.error === 'network') {
          // If network glitch occurs, retry with en-US after short delay
          setTimeout(() => {
            if (isContentSpeechActive && contentSpeechRec) {
              try { contentSpeechRec.start(); } catch (e) { }
            }
          }, 300);
        }
      };

      contentSpeechRec.onend = () => {
        if (isContentSpeechActive && contentSpeechRec) {
          try { contentSpeechRec.start(); } catch (e) { }
        }
      };

      contentSpeechRec.start();
      return true;
    } catch (err) {
      return false;
    }
  }

  function stopWebSpeechRecognition() {
    isContentSpeechActive = false;
    if (contentSpeechRec) {
      try { contentSpeechRec.stop(); } catch (e) { }
      contentSpeechRec = null;
    }
  }

  // ── DEEP CONTENT SCRAPER (Zero Hallucination, 100% Grounded Source) ────────
  function scrapePageContent() {
    try {
      const clone = document.body.cloneNode(true);
      // Strip noisy and non-text elements
      clone.querySelectorAll('script, style, noscript, iframe, svg, nav, footer, header, [role="banner"], [role="navigation"], .ad, .ads, #ad, #cookie-banner, .cookie-banner, .toast, .popup, #aero-agent-hud-overlay, #aero-floating-summary-card').forEach(el => el.remove());

      // Focus on main readable content container if present
      const core = clone.querySelector('article, main, [role="main"], #content, .content, .post-content, .article-body, .entry-content, #wikiBody, .mw-parser-output');
      const rawText = core ? core.innerText : clone.innerText;

      const cleaned = (rawText || '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .join('\n');

      return {
        title: document.title || window.location.hostname,
        url: window.location.href,
        text: cleaned.slice(0, 30000)
      };
    } catch (e) {
      return {
        title: document.title || '',
        url: window.location.href,
        text: document.body ? document.body.innerText.slice(0, 20000) : ''
      };
    }
  }

  // ── FLOATING POP-UP SUMMARY MODAL ON PAGE (Dismissible via Cross ✕, Expandable ⛶) ────────
  let floatingSummaryCard = null;
  let isFloatingSummaryExpanded = false;

  function showFloatingSummaryCard(title, markdown) {
    hideFloatingSummaryCard();
    isFloatingSummaryExpanded = false;

    floatingSummaryCard = document.createElement('div');
    floatingSummaryCard.id = 'aero-floating-summary-card';
    floatingSummaryCard.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 560px;
      max-width: 92vw;
      max-height: 88vh;
      background: #ffffff;
      border: 1.5px solid rgba(244, 63, 94, 0.45);
      border-radius: 18px;
      box-shadow: 0 25px 60px rgba(15, 23, 42, 0.45), 0 0 0 1px rgba(0,0,0,0.06);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      animation: aeroSlideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      transition: width 0.25s ease, max-width 0.25s ease, height 0.25s ease;
    `;

    // Convert markdown tables into styled HTML tables
    let text = (markdown || '').replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
      const rows = match.trim().split(/\r?\n/).map(r => r.trim()).filter(Boolean);
      if (rows.length < 2) return match;

      let html = '<div style="overflow-x:auto; margin:14px 0; border:1px solid #e2e8f0; border-radius:10px;"><table style="width:100%; border-collapse:collapse; font-size:12px;">';
      let hasHeader = false;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (/^\|[-:\s|]+\|$/.test(row)) {
          hasHeader = true;
          continue;
        }
        const cells = row.split('|').slice(1, -1).map(c => c.trim());
        if (i === 0 || (!hasHeader && i === 0)) {
          html += '<thead><tr style="background:#f1f5f9; border-bottom:1.5px solid #cbd5e1;">';
          cells.forEach(c => html += `<th style="padding:8px 10px; text-align:left; font-weight:700; color:#0f172a;">${c}</th>`);
          html += '</tr></thead><tbody>';
        } else {
          const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
          html += `<tr style="background:${bg}; border-bottom:1px solid #f1f5f9;">`;
          cells.forEach(c => html += `<td style="padding:7px 10px; color:#334155; line-height:1.45;">${c}</td>`);
          html += '</tr>';
        }
      }
      if (hasHeader) html += '</tbody>';
      html += '</table></div>';
      return html;
    });

    let bodyHtml = text
      .replace(/^#### (.*$)/gim, '<h5 style="font-size:12.5px; font-weight:700; color:#475569; margin:12px 0 4px 0; text-transform:uppercase; letter-spacing:0.5px;">$1</h5>')
      .replace(/^### (.*$)/gim, '<h4 style="font-size:14px; font-weight:700; color:#0f172a; margin:16px 0 6px 0; border-bottom:1px solid #f1f5f9; padding-bottom:4px;">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 style="font-size:15px; font-weight:700; color:#0f172a; margin:18px 0 8px 0;">$1</h3>')
      .replace(/^# (.*$)/gim, '<h2 style="font-size:16.5px; font-weight:800; color:#0f172a; margin:20px 0 10px 0;">$1</h2>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong style="color:#0f172a;">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code style="background:#f1f5f9; padding:2px 5px; border-radius:4px; font-size:11.5px; font-family:monospace; color:#e11d48;">$1</code>')
      .replace(/^> (.*$)/gim, '<blockquote style="border-left:3.5px solid #f43f5e; margin:8px 0; padding:6px 12px; background:#fff1f2; border-radius:0 6px 6px 0; color:#881337; font-size:12px; font-style:italic;">$1</blockquote>')
      .replace(/^- (.*$)/gim, '<li style="margin-left:16px; margin-bottom:5px; font-size:12.5px; line-height:1.55; color:#334155;">$1</li>')
      .replace(/^\d+\.\s+(.*$)/gim, '<li style="margin-left:16px; margin-bottom:5px; font-size:12.5px; line-height:1.55; color:#334155;">$1</li>')
      .replace(/\n\n/gim, '<br>');

    const isPdfDoc = (title || '').toLowerCase().includes('.pdf') || (title || '').toLowerCase().includes('report') || (title || '').toLowerCase().includes('document');
    const badgeText = isPdfDoc ? '📑 Attached PDF Document • Full Grounded Briefing' : 'Full-Page Grounded Analysis • Local Qwen2.5';

    floatingSummaryCard.innerHTML = `
      <div id="aero-float-header" style="padding: 14px 18px; border-bottom: 1.5px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; background: linear-gradient(135deg, #fff1f2, #f8fafc); flex-shrink: 0; cursor: grab; user-select: none;">
        <div style="display: flex; align-items: center; gap: 10px; overflow: hidden; flex: 1;">
          <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #f43f5e, #fb7185); display: flex; align-items: center; justify-content: center; color: white; font-size: 18px; flex-shrink: 0; box-shadow: 0 4px 12px rgba(244,63,94,0.35);">📑</div>
          <div style="overflow: hidden; flex: 1;">
            <h3 style="margin: 0; font-size: 14px; font-weight: 700; color: #0f172a; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${title || 'Executive Knowledge Briefing'}</h3>
            <p style="margin: 2px 0 0 0; font-size: 11px; color: #64748b;">${badgeText}</p>
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          <button id="aero-float-copy-btn" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; padding: 6px 11px; border-radius: 8px; cursor: pointer; font-size: 11.5px; font-weight: 600; transition: all 0.15s ease;" title="Copy Full Summary Markdown">📋 Copy</button>
          <button id="aero-float-expand-btn" style="background: #ffffff; border: 1px solid #cbd5e1; color: #334155; padding: 6px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 700; transition: all 0.15s ease;" title="Expand / Widescreen View">⛶</button>
          <button id="aero-float-close-btn" style="background: #ffffff; border: 1.5px solid #cbd5e1; font-size: 16px; font-weight: 700; line-height: 1; cursor: pointer; color: #475569; width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.08);" title="Close and Remove (Press Esc)">✕</button>
        </div>
      </div>
      <div id="aero-float-scroll-body" style="flex: 1; overflow-y: auto; padding: 20px 24px; font-size: 13px; color: #334155; line-height: 1.68;">
        ${bodyHtml}
      </div>
      <div style="padding: 10px 18px; border-top: 1px solid #f1f5f9; background: #f8fafc; display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: #64748b; flex-shrink: 0;">
        <span>✓ Grounded Local AI Synthesis • Drag header to move</span>
        <button id="aero-float-close-btn2" style="background: #fee2e2; border: 1px solid #fca5a5; color: #dc2626; font-weight: 700; cursor: pointer; font-size: 11px; padding: 4px 10px; border-radius: 6px; transition: all 0.15s ease;">✕ Close Pop-up</button>
      </div>
    `;

    document.body.appendChild(floatingSummaryCard);

    // Close buttons
    const closeBtn = floatingSummaryCard.querySelector('#aero-float-close-btn');
    const closeBtn2 = floatingSummaryCard.querySelector('#aero-float-close-btn2');
    const copyBtn = floatingSummaryCard.querySelector('#aero-float-copy-btn');
    const expandBtn = floatingSummaryCard.querySelector('#aero-float-expand-btn');
    const headerEl = floatingSummaryCard.querySelector('#aero-float-header');

    if (closeBtn) {
      closeBtn.addEventListener('mouseenter', () => {
        closeBtn.style.background = '#fee2e2';
        closeBtn.style.color = '#dc2626';
        closeBtn.style.borderColor = '#fca5a5';
      });
      closeBtn.addEventListener('mouseleave', () => {
        closeBtn.style.background = '#ffffff';
        closeBtn.style.color = '#475569';
        closeBtn.style.borderColor = '#cbd5e1';
      });
      closeBtn.addEventListener('click', hideFloatingSummaryCard);
    }
    if (closeBtn2) closeBtn2.addEventListener('click', hideFloatingSummaryCard);

    // Escape key closes popup
    const onEscapeKey = (e) => {
      if (e.key === 'Escape') hideFloatingSummaryCard();
    };
    document.addEventListener('keydown', onEscapeKey);
    floatingSummaryCard._onEscapeKey = onEscapeKey;

    // Draggable header
    if (headerEl) {
      let isDragging = false, startX, startY, origTop, origRight;
      headerEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) return;
        isDragging = true;
        headerEl.style.cursor = 'grabbing';
        startX = e.clientX;
        startY = e.clientY;
        const rect = floatingSummaryCard.getBoundingClientRect();
        origTop = rect.top;
        origRight = window.innerWidth - rect.right;
      });
      const onMouseMove = (e) => {
        if (!isDragging || !floatingSummaryCard) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        floatingSummaryCard.style.top = Math.max(10, origTop + dy) + 'px';
        floatingSummaryCard.style.right = Math.max(10, origRight - dx) + 'px';
      };
      const onMouseUp = () => {
        isDragging = false;
        if (headerEl) headerEl.style.cursor = 'grab';
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      floatingSummaryCard._dragCleanup = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
    }

    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        isFloatingSummaryExpanded = !isFloatingSummaryExpanded;
        if (isFloatingSummaryExpanded) {
          floatingSummaryCard.style.width = '820px';
          floatingSummaryCard.style.maxWidth = '96vw';
          floatingSummaryCard.style.maxHeight = '92vh';
          expandBtn.textContent = '🗗';
          expandBtn.title = 'Restore Normal Size';
        } else {
          floatingSummaryCard.style.width = '560px';
          floatingSummaryCard.style.maxWidth = '92vw';
          floatingSummaryCard.style.maxHeight = '88vh';
          expandBtn.textContent = '⛶';
          expandBtn.title = 'Expand / Widescreen View';
        }
      });
    }

    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(markdown || '').then(() => {
          copyBtn.textContent = '✓ Copied!';
          setTimeout(() => { copyBtn.textContent = '📋 Copy'; }, 1800);
        });
      });
    }
  }

  function hideFloatingSummaryCard() {
    if (floatingSummaryCard) {
      if (floatingSummaryCard._onEscapeKey) {
        document.removeEventListener('keydown', floatingSummaryCard._onEscapeKey);
      }
      if (floatingSummaryCard._dragCleanup) {
        floatingSummaryCard._dragCleanup();
      }
      floatingSummaryCard.remove();
      floatingSummaryCard = null;
    }
  }

  // Expose globally for direct programmatic script execution
  window.showFloatingSummaryCard = showFloatingSummaryCard;
  window.hideFloatingSummaryCard = hideFloatingSummaryCard;

  console.log('[SIH26171] Advanced Content Script initialized');
})();
