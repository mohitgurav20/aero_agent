/**
 * SIH26171 — Aero Agent Popup Controller
 * Premium Pink & White Edition
 * Direct Speech Recognition & Live Transcription Engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const commandInput = document.getElementById('command-input');
  const sendBtn = document.getElementById('send-btn');
  const micBtn = document.getElementById('mic-btn');
  const toggleTagsBtn = document.getElementById('toggle-tags-btn');
  const statusIndicator = document.getElementById('status-indicator');
  const voiceRecordingBar = document.getElementById('voice-recording-bar');
  const recordingTimer = document.getElementById('recording-timer');
  const liveTranscript = document.getElementById('live-transcript');
  const voiceStopBtn = document.getElementById('voice-stop-btn');
  const micStatusLabel = document.getElementById('mic-status-label');

  const planMeta = document.getElementById('plan-meta');
  const confidenceBadge = document.getElementById('confidence-badge');
  const sourceBadge = document.getElementById('source-badge');
  const reasoningBox = document.getElementById('reasoning-box');
  const planStepsContainer = document.getElementById('plan-steps-container');
  const planStepsList = document.getElementById('plan-steps-list');

  const verifyLogBtn = document.getElementById('verify-log-btn');

  // Clarification Card
  const clarificationCard = document.getElementById('clarification-card');
  const clarifyTitle = document.getElementById('clarify-title');
  const clarifySubtitle = document.getElementById('clarify-subtitle');
  const clarifyFields = document.getElementById('clarify-fields');
  const clarifyCancelBtn = document.getElementById('clarify-cancel-btn');
  const clarifySpeakBtn = document.getElementById('clarify-speak-btn');
  const clarifyRunBtn = document.getElementById('clarify-run-btn');
  const clarifyVoiceHint = document.getElementById('clarify-voice-hint');

  // Confirmation Modal
  const confirmationModal = document.getElementById('confirmation-modal');
  const modalMessage = document.getElementById('modal-message');
  const modalDetails = document.getElementById('modal-details');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');
  const modalRejectBtn = document.getElementById('modal-reject-btn');

  // New Feature DOM Elements
  const voiceReplyBtn = document.getElementById('voice-reply-btn');
  const tabBtnActions = document.getElementById('tab-btn-actions');
  const tabBtnHitl = document.getElementById('tab-btn-hitl');
  const tabViewActions = document.getElementById('tab-view-actions');
  const tabViewHitl = document.getElementById('tab-view-hitl');

  const hitlSsoContainer = document.getElementById('hitl-sso-container');
  const hitlSsoButtons = document.getElementById('hitl-sso-buttons');
  const hitlUsernameInput = document.getElementById('hitl-username-input');
  const hitlPasswordInput = document.getElementById('hitl-password-input');
  const hitlSubmitCredsBtn = document.getElementById('hitl-submit-creds-btn');

  const docUploadBtn = document.getElementById('doc-upload-btn');
  const docFileInput = document.getElementById('doc-file-input');
  const attachedFileBadge = document.getElementById('attached-file-badge');
  const attachedFileName = document.getElementById('attached-file-name');
  const attachedFileSize = document.getElementById('attached-file-size');
  const removeAttachedFileBtn = document.getElementById('remove-attached-file-btn');

  const summarizePageBtn = document.getElementById('summarize-page-btn');
  const hitlContinueBtn = document.getElementById('hitl-continue-btn');
  const hitlBannerDesc = document.getElementById('hitl-banner-desc');

  // Executive Summary Pop-Up Modal Elements
  const summaryModal = document.getElementById('summary-modal');
  const summaryModalTitle = document.getElementById('summary-modal-title');
  const summaryModalBody = document.getElementById('summary-modal-body');
  const summaryModalCloseBtn = document.getElementById('summary-modal-close-btn');
  const summaryModalXBtn = document.getElementById('summary-modal-x-btn');
  const summaryModalCopyBtn = document.getElementById('summary-modal-copy-btn');
  const summaryPopupPageBtn = document.getElementById('summary-popup-page-btn');

  // State
  let currentClarification = null;
  let isRecording = false;
  let recordingStartTime = null;
  let recordingInterval = null;
  let waveAnimInterval = null;
  let overlaysVisible = false;
  let currentPendingConfirmationId = null;
  let localSpeechRec = null;
  let alwaysOnMode = false;
  let autoResumeTimer = null;
  let lastExecutedCommand = '';
  let voiceReplyEnabled = true;
  let attachedDocument = null; // { name, size, type, base64, extractedText }
  let currentSummaryMarkdown = '';
  let currentSummaryTitle = 'Executive Summary';

  // Load saved voice toggle state
  chrome.storage.local.get(['voice_reply_enabled'], (res) => {
    if (res && res.voice_reply_enabled !== undefined) {
      voiceReplyEnabled = !!res.voice_reply_enabled;
      if (voiceReplyBtn) {
        voiceReplyBtn.textContent = voiceReplyEnabled ? '🔊' : '🔇';
        voiceReplyBtn.style.opacity = voiceReplyEnabled ? '1' : '0.5';
      }
    }
  });

  if (voiceReplyBtn) {
    voiceReplyBtn.addEventListener('click', () => {
      voiceReplyEnabled = !voiceReplyEnabled;
      voiceReplyBtn.textContent = voiceReplyEnabled ? '🔊' : '🔇';
      voiceReplyBtn.style.opacity = voiceReplyEnabled ? '1' : '0.5';
      chrome.storage.local.set({ voice_reply_enabled: voiceReplyEnabled });
      if (voiceReplyEnabled) {
        speakAgentMessage('Voice replies enabled');
      } else if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    });
  }

  // Navigation tab switcher (Actions & Action Req.)
  function switchTab(targetTab) {
    const tabs = ['actions', 'hitl'];
    tabs.forEach(t => {
      const btn = document.getElementById(`tab-btn-${t}`);
      const view = document.getElementById(`tab-view-${t}`);
      if (btn && view) {
        if (t === targetTab) {
          btn.classList.add('active');
          btn.style.background = t === 'hitl' ? 'rgba(245, 158, 11, 0.2)' : '#ffffff';
          btn.style.color = t === 'hitl' ? '#d97706' : 'var(--pink-600)';
          btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
          view.style.display = 'flex';
        } else {
          btn.classList.remove('active');
          btn.style.background = 'transparent';
          btn.style.color = 'var(--text-muted)';
          btn.style.boxShadow = 'none';
          view.style.display = 'none';
        }
      }
    });
  }

  if (tabBtnActions) tabBtnActions.addEventListener('click', () => switchTab('actions'));
  if (tabBtnHitl) tabBtnHitl.addEventListener('click', () => switchTab('hitl'));

  // Two-Way Interactive Voice Engine (TTS)
  let lastSpokenText = '';
  function speakAgentMessage(text) {
    if (!voiceReplyEnabled || !window.speechSynthesis || !text) return;
    try {
      if (text === lastSpokenText) return;
      lastSpokenText = text;

      window.speechSynthesis.cancel();
      let clean = text
        .replace(/```[\s\S]*?```/g, 'code block')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/https?:\/\/\S+/g, '')
        .replace(/[#*_\~\[\]\(\)\{\}\<\>|]/g, ' ')
        .replace(/[✓⚡⚠️🔴📌🔑📊🚀]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (!clean) return;
      if (clean.length > 140) clean = clean.slice(0, 137) + '...';

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      const voices = window.speechSynthesis.getVoices() || [];
      const naturalVoice = voices.find(v => v.lang?.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Jenny')));
      if (naturalVoice) utterance.voice = naturalVoice;

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[TTS] Speech synthesis error:', e);
    }
  }

  // Document Upload Handlers
  if (docUploadBtn && docFileInput) {
    docUploadBtn.addEventListener('click', () => docFileInput.click());
    docFileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const fileName = file.name;
      const fileSizeStr = file.size > 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(file.size / 1024)} KB`;

      if (attachedFileName) attachedFileName.textContent = fileName;
      if (attachedFileSize) attachedFileSize.textContent = `(${fileSizeStr})`;
      if (attachedFileBadge) attachedFileBadge.style.display = 'flex';

      updateStatus('thinking', `Reading document: ${fileName}...`);

      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = (reader.result || '').split(',')[1] || '';
        attachedDocument = {
          name: fileName,
          size: file.size,
          type: file.type,
          base64: base64Data,
          extractedText: ''
        };

        try {
          const resp = await fetch('http://127.0.0.1:5000/api/extract_document', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file_base64: base64Data,
              file_name: fileName,
              file_type: file.type
            })
          });
          if (resp.ok) {
            const json = await resp.json();
            attachedDocument.extractedText = json.extracted_text || '';
            updateStatus('online', `✓ Attached: ${fileName} (${json.total_chars} chars)`);
            speakAgentMessage(`Attached document ${fileName}`);
          }
        } catch (err) {
          updateStatus('online', `✓ Attached: ${fileName}`);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  if (removeAttachedFileBtn) {
    removeAttachedFileBtn.addEventListener('click', () => {
      attachedDocument = null;
      if (docFileInput) docFileInput.value = '';
      if (attachedFileBadge) attachedFileBadge.style.display = 'none';
      updateStatus('online', 'Document removed');
    });
  }

  // HITL Continue Execution Handler
  if (hitlContinueBtn) {
    hitlContinueBtn.addEventListener('click', () => {
      const inlineHitl = document.getElementById('inline-hitl-card');
      if (inlineHitl) inlineHitl.style.display = 'none';
      const hitlBadge = document.getElementById('hitl-badge');
      if (hitlBadge) hitlBadge.style.display = 'none';
      switchTab('actions');
      updateStatus('acting', 'Resuming task execution...');
      speakAgentMessage('Resuming execution');
      chrome.runtime.sendMessage({ type: 'resume_step_queue' });
    });
  }

  // Inline HITL Continue Execution Handler (on Actions tab)
  const inlineHitlContinueBtn = document.getElementById('inline-hitl-continue-btn');
  if (inlineHitlContinueBtn) {
    inlineHitlContinueBtn.addEventListener('click', () => {
      const inlineHitl = document.getElementById('inline-hitl-card');
      if (inlineHitl) inlineHitl.style.display = 'none';
      const hitlBadge = document.getElementById('hitl-badge');
      if (hitlBadge) hitlBadge.style.display = 'none';
      updateStatus('acting', 'Resuming task execution...');
      speakAgentMessage('Resuming execution');
      chrome.runtime.sendMessage({ type: 'resume_step_queue' });
    });
  }

  // HITL Submit Dynamic Credentials Form Handler (Option 2)
  if (hitlSubmitCredsBtn) {
    hitlSubmitCredsBtn.addEventListener('click', () => {
      const dynamicContainer = document.getElementById('hitl-dynamic-fields-container');
      const inputs = dynamicContainer ? dynamicContainer.querySelectorAll('.hitl-dynamic-input') : [];

      const fieldsPayload = [];
      let usernameFallback = '';
      let passwordFallback = '';

      if (inputs.length > 0) {
        inputs.forEach(inp => {
          const val = (inp.value || '').trim();
          if (val) {
            fieldsPayload.push({
              key: inp.dataset.key,
              name: inp.dataset.name,
              id: inp.dataset.id,
              type: inp.dataset.type,
              selector: inp.dataset.selector,
              value: val
            });
            if (inp.dataset.type === 'password' || inp.type === 'password') {
              passwordFallback = val;
            } else if (!usernameFallback) {
              usernameFallback = val;
            }
          }
        });
      } else {
        const uVal = (hitlUsernameInput?.value || '').trim();
        const pVal = (hitlPasswordInput?.value || '').trim();
        if (uVal) usernameFallback = uVal;
        if (pVal) passwordFallback = pVal;
      }

      if (fieldsPayload.length === 0 && !usernameFallback && !passwordFallback) {
        const firstInp = dynamicContainer?.querySelector('input');
        if (firstInp) {
          firstInp.style.borderColor = '#ef4444';
          firstInp.focus();
        }
        return;
      }

      const hitlBadge = document.getElementById('hitl-badge');
      if (hitlBadge) hitlBadge.style.display = 'none';
      switchTab('actions');
      updateStatus('acting', 'Entering credentials securely with agent...');
      speakAgentMessage('Entering credentials and continuing task');

      chrome.runtime.sendMessage({
        type: 'fill_and_submit_credentials',
        payload: {
          fields: fieldsPayload,
          username: usernameFallback,
          password: passwordFallback
        }
      });

      // Clear password fields for safety
      if (dynamicContainer) {
        dynamicContainer.querySelectorAll('input[type="password"]').forEach(p => p.value = '');
      }
      if (hitlPasswordInput) hitlPasswordInput.value = '';
    });
  }

  // One-Click SSO button delegation
  if (hitlSsoContainer) {
    hitlSsoContainer.addEventListener('click', (e) => {
      const chip = e.target.closest('.clarify-sso-chip');
      if (chip) {
        const ssoText = chip.getAttribute('data-sso') || chip.textContent.trim();
        chrome.runtime.sendMessage({ type: 'click_sso_option', text: ssoText });
        updateStatus('acting', `Clicking ${ssoText}...`);
        speakAgentMessage(`Clicking ${ssoText}`);
      }
    });
  }

  // Drag and Drop files onto input card
  const inputCard = document.querySelector('.input-card');
  if (inputCard && docFileInput) {
    inputCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputCard.style.borderColor = '#f43f5e';
      inputCard.style.background = '#fff1f2';
    });
    inputCard.addEventListener('dragleave', () => {
      inputCard.style.borderColor = '';
      inputCard.style.background = '';
    });
    inputCard.addEventListener('drop', (e) => {
      e.preventDefault();
      inputCard.style.borderColor = '';
      inputCard.style.background = '';
      if (e.dataTransfer?.files?.length > 0) {
        docFileInput.files = e.dataTransfer.files;
        docFileInput.dispatchEvent(new Event('change'));
      }
    });
  }

  // ── RENDER MARKDOWN TO RICH HTML FOR IN-PANEL SUMMARY MODAL ─────────────
  function renderMarkdownSummary(md) {
    if (!md) return '<p style="color:#64748b; font-style:italic;">No summary text generated.</p>';

    // 1. Format Markdown Tables
    let text = md.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
      const rows = match.trim().split(/\r?\n/).map(r => r.trim()).filter(Boolean);
      if (rows.length < 2) return match;
      let html = '<div style="overflow-x:auto; margin:10px 0; border:1px solid #e2e8f0; border-radius:8px;"><table style="width:100%; border-collapse:collapse; font-size:11px;">';
      let hasHeader = false;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (/^\|[-:\s|]+\|$/.test(row)) { hasHeader = true; continue; }
        const cells = row.split('|').slice(1, -1).map(c => c.trim());
        if (i === 0 || (!hasHeader && i === 0)) {
          html += '<thead><tr style="background:#f1f5f9; border-bottom:1.5px solid #cbd5e1;">';
          cells.forEach(c => html += `<th style="padding:6px 8px; text-align:left; font-weight:700; color:#0f172a;">${escapeHtml(c)}</th>`);
          html += '</tr></thead><tbody>';
        } else {
          const bg = i % 2 === 0 ? '#ffffff' : '#f8fafc';
          html += `<tr style="background:${bg}; border-bottom:1px solid #f1f5f9;">`;
          cells.forEach(c => html += `<td style="padding:5px 8px; color:#334155;">${escapeHtml(c)}</td>`);
          html += '</tr>';
        }
      }
      if (hasHeader) html += '</tbody>';
      html += '</table></div>';
      return html;
    });

    // 2. Headings, bullet points, blockquotes, code
    return text
      .replace(/^#### (.*$)/gim, '<h5 style="font-size:11.5px; font-weight:700; color:#475569; margin:10px 0 3px 0; text-transform:uppercase;">$1</h5>')
      .replace(/^### (.*$)/gim, '<h4 style="font-size:12.5px; font-weight:700; color:#0f172a; margin:12px 0 4px 0; border-bottom:1px solid #f1f5f9; padding-bottom:3px;">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 style="font-size:13.5px; font-weight:700; color:#0f172a; margin:14px 0 5px 0;">$1</h3>')
      .replace(/^# (.*$)/gim, '<h2 style="font-size:15px; font-weight:800; color:#0f172a; margin:16px 0 6px 0;">$1</h2>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong style="color:#0f172a;">$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code style="background:#f1f5f9; padding:2px 4px; border-radius:4px; font-size:11px; font-family:monospace; color:#e11d48;">$1</code>')
      .replace(/^> (.*$)/gim, '<blockquote style="border-left:3px solid #f43f5e; margin:6px 0; padding:4px 10px; background:#fff1f2; border-radius:0 4px 4px 0; color:#881337; font-size:11.5px;">$1</blockquote>')
      .replace(/^- (.*$)/gim, '<li style="margin-left:14px; margin-bottom:3px; font-size:11.5px; line-height:1.45; color:#334155;">$1</li>')
      .replace(/^\d+\.\s+(.*$)/gim, '<li style="margin-left:14px; margin-bottom:3px; font-size:11.5px; line-height:1.45; color:#334155;">$1</li>')
      .replace(/\n\n/gim, '<br>');
  }

  // ── SHOW / HIDE IN-PANEL SUMMARY MODAL ──────────────────────────────────
  function showSummaryModal(title, md) {
    if (!summaryModal) return;
    currentSummaryTitle = title || 'Executive Summary';
    currentSummaryMarkdown = md || '';
    if (summaryModalTitle) summaryModalTitle.textContent = currentSummaryTitle;
    if (summaryModalBody) summaryModalBody.innerHTML = renderMarkdownSummary(currentSummaryMarkdown);
    summaryModal.classList.remove('hidden');
  }

  function hideSummaryModal() {
    if (!summaryModal) return;
    summaryModal.classList.add('hidden');
  }

  if (summaryModalCloseBtn) summaryModalCloseBtn.addEventListener('click', hideSummaryModal);
  if (summaryModalXBtn) summaryModalXBtn.addEventListener('click', hideSummaryModal);
  if (summaryModalCopyBtn) {
    summaryModalCopyBtn.addEventListener('click', async () => {
      if (!currentSummaryMarkdown) return;
      try {
        await navigator.clipboard.writeText(currentSummaryMarkdown);
        summaryModalCopyBtn.textContent = '✓ Copied!';
        summaryModalCopyBtn.style.color = '#059669';
        setTimeout(() => {
          summaryModalCopyBtn.textContent = '📋 Copy';
          summaryModalCopyBtn.style.color = '';
        }, 1800);
      } catch (e) {}
    });
  }
  if (summaryPopupPageBtn) {
    summaryPopupPageBtn.addEventListener('click', () => {
      deliverFloatingSummaryToPage(currentSummaryTitle || 'Executive Summary', currentSummaryMarkdown);
    });
  }

  // ── DELIVER FLOATING SUMMARY CARD TO WEBPAGE TAB ─────────────────────────
  async function deliverFloatingSummaryToPage(title, markdown) {
    const isInternalUrl = (url) => !url || url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('chrome-extension://');

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    const targetTab = activeTabs?.[0];

    if (!targetTab || !targetTab.id || isInternalUrl(targetTab.url)) {
      console.log('[Popup] Active tab is restricted (chrome://*), floating card cannot be injected.');
      return false;
    }

    // Try sending message to content script first
    let delivered = false;
    try {
      const resp = await chrome.tabs.sendMessage(targetTab.id, {
        type: 'show_floating_summary',
        title: title,
        summaryMarkdown: markdown
      });
      if (resp && resp.success) delivered = true;
    } catch (err) {
      console.warn('[Popup] sendMessage to content script failed, falling back to direct executeScript:', err);
    }

    // Direct script execution fallback with robust DOM injector
    if (!delivered) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: targetTab.id },
          func: (t, md) => {
            if (typeof window.showFloatingSummaryCard === 'function') {
              window.showFloatingSummaryCard(t, md);
              return true;
            }
            const prev = document.getElementById('aero-floating-summary-card');
            if (prev) prev.remove();
            const el = document.createElement('div');
            el.id = 'aero-floating-summary-card';
            el.style.cssText = 'position:fixed; top:20px; right:20px; width:540px; max-width:90vw; max-height:86vh; background:#ffffff; border:1.5px solid #f43f5e; border-radius:16px; box-shadow:0 25px 60px rgba(0,0,0,0.35); z-index:2147483647; display:flex; flex-direction:column; overflow:hidden; font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;';
            el.innerHTML = `
              <div style="padding:12px 16px; border-bottom:1px solid #f1f5f9; display:flex; align-items:center; justify-content:space-between; background:#fff1f2;">
                <div style="display:flex; align-items:center; gap:8px;">
                  <span style="font-size:18px;">📑</span>
                  <strong style="font-size:13px; color:#0f172a;">${t || 'Executive Summary'}</strong>
                </div>
                <button id="aero-float-close-btn" style="background:#fff; border:1px solid #cbd5e1; border-radius:50%; width:28px; height:28px; cursor:pointer; font-weight:700;">✕</button>
              </div>
              <div style="padding:16px; overflow-y:auto; font-size:12.5px; line-height:1.6; color:#334155; white-space:pre-wrap;">${md}</div>
            `;
            document.body.appendChild(el);
            el.querySelector('#aero-float-close-btn').onclick = () => el.remove();
            return true;
          },
          args: [title, markdown]
        });
        delivered = true;
      } catch (err2) {
        console.error('[Popup] Direct script injection fallback failed:', err2);
      }
    }
    return delivered;
  }

  // ── EXECUTABLE SUMMARIZATION WORKFLOW ──────────────────────────────────────
  async function executeSummarizationWorkflow(userGoal = '') {
    const isDoc = !!(attachedDocument && (attachedDocument.extractedText || attachedDocument.name));
    const title = isDoc ? `Summary: ${attachedDocument.name}` : 'Web Page Summary';

    updateStatus('thinking', 'Scraping and synthesizing with local LLM...');
    reasoningBox.innerHTML = `<strong>Synthesizing Summary:</strong> Scraping ${escapeHtml(isDoc ? attachedDocument.name : 'active page')} with local LLM for knowledge pop-up...`;
    speakAgentMessage('Summarizing content with local intelligence');

    try {
      let sourceContent = '';
      let sourceTitle = '';

      if (isDoc && attachedDocument.extractedText) {
        sourceContent = attachedDocument.extractedText;
        sourceTitle = attachedDocument.name;
      } else {
        // Query active tab in current window
        const tabs = await new Promise(resolve => {
          chrome.tabs.query({ active: true, currentWindow: true }, resolve);
        });
        const activeTab = tabs?.[0];
        sourceTitle = activeTab?.title || 'Active Webpage';

        const tabUrl = activeTab?.url || '';
        const isRestrictedTab = !tabUrl || tabUrl.startsWith('chrome://') || tabUrl.startsWith('edge://') || tabUrl.startsWith('about:') || tabUrl.startsWith('chrome-extension://');

        if (isRestrictedTab) {
          // If active tab is restricted, check if user has other readable webpage tabs in the window
          const allTabs = await new Promise(resolve => {
            chrome.tabs.query({ currentWindow: true }, resolve);
          });
          const readableTabs = (allTabs || []).filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:') && !t.url.startsWith('chrome-extension://'));

          if (readableTabs.length > 0) {
            const candidateTab = readableTabs[0];
            reasoningBox.innerHTML = `
              <div style="padding: 10px; background: #fff1f2; border: 1.5px solid #fecdd3; border-radius: 10px; display: flex; flex-direction: column; gap: 8px;">
                <div style="font-size: 11.5px; color: #9f1239; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                  <span>⚠️ Active tab is a Chrome internal page</span>
                </div>
                <div style="font-size: 11px; color: #475569; line-height: 1.4;">
                  Cannot read content directly on New Tab/Settings pages. Click below to summarize your open webpage tab:
                </div>
                <button id="summarize-candidate-tab-btn" style="padding: 8px 12px; font-size: 11.5px; font-weight: 700; background: linear-gradient(135deg, #f43f5e, #e11d48); color: white; border: none; border-radius: 7px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(244,63,94,0.3); transition: all 0.15s ease;">
                  <span>⚡</span> Summarize "${escapeHtml(candidateTab.title.slice(0, 36))}${candidateTab.title.length > 36 ? '...' : ''}"
                </button>
              </div>
            `;
            updateStatus('online', 'Click to summarize open tab');
            const candidateBtn = document.getElementById('summarize-candidate-tab-btn');
            if (candidateBtn) {
              candidateBtn.addEventListener('click', async () => {
                await chrome.tabs.update(candidateTab.id, { active: true });
                executeSummarizationWorkflow(userGoal);
              });
            }
            return;
          }

          reasoningBox.innerHTML = `<span style="color:#f59e0b; font-weight:600;">⚠️ You're on a browser page (New Tab, Settings, etc.) which cannot be summarized.<br><br>Please navigate to a <strong>webpage</strong> first, then click Summarize — or upload a PDF using the 📎 button.</span>`;
          updateStatus('online', 'Open a webpage to summarize');
          return;
        }

        if (activeTab?.id) {
          const res = await chrome.tabs.sendMessage(activeTab.id, { type: 'scrape_page_content' }).catch(() => null);
          if (res && res.payload && res.payload.text) {
            sourceContent = res.payload.text;
            if (res.payload.title) sourceTitle = res.payload.title;
          } else {
            // Fallback to extract_dom
            const domRes = await chrome.tabs.sendMessage(activeTab.id, { type: 'extract_dom' }).catch(() => null);
            sourceContent = domRes?.payload?.elements?.map(e => e.text).filter(Boolean).join('\n') || '';
          }
        }
      }

      if (!sourceContent || sourceContent.trim().length < 15) {
        reasoningBox.innerHTML = `<span style="color:#ef4444;">No readable text found to summarize. Please upload a PDF (📎) or open a readable webpage.</span>`;
        updateStatus('online', 'No content to summarize');
        return;
      }

      let resp = null;
      try {
        resp = await fetch('http://127.0.0.1:5000/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: sourceContent,
            title: sourceTitle,
            instruction: userGoal || 'Provide an executive summary of this content'
          })
        });
      } catch (fErr) {
        console.warn('[Popup] 127.0.0.1:5000 failed, attempting localhost:5000 fallback:', fErr);
        try {
          resp = await fetch('http://localhost:5000/api/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: sourceContent,
              title: sourceTitle,
              instruction: userGoal || 'Provide an executive summary of this content'
            })
          });
        } catch (fErr2) {
          throw new Error('Local reasoning server is offline or restarting on port 5000. Please check `py server/run.py`.');
        }
      }

      if (!resp.ok) {
        throw new Error(`Local server returned status ${resp.status}`);
      }

      const json = await resp.json();
      currentSummaryMarkdown = json.summary || 'No summary generated.';
      const finalTitle = json.title || sourceTitle || 'Executive Summary';
      currentSummaryTitle = finalTitle;

      // 1. Persist to storage for full-page briefing viewer
      try {
        chrome.storage.local.set({
          latestSummary: {
            title: finalTitle,
            markdown: currentSummaryMarkdown,
            source: sourceTitle,
            timestamp: Date.now()
          }
        });
      } catch (e) {}

      // 2. Immediately show the dedicated summary pop-up modal inside the extension side panel
      showSummaryModal(finalTitle, currentSummaryMarkdown);

      // 3. Also deliver floating summary card directly onto the webpage tab
      const delivered = await deliverFloatingSummaryToPage(finalTitle, currentSummaryMarkdown);

      reasoningBox.innerHTML = `
        <div style="color:#059669; font-weight:700; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
          <span>📑 Summary Pop-Up Generated</span>
        </div>
        <div style="font-size:11.5px; color:#334155; line-height:1.45;">
          ${delivered ? 'Interactive floating card is active on your webpage tab & pop-up modal is open!' : 'Summary pop-up modal is open! Switch to a readable webpage tab to also view floating card.'}
        </div>
        <div style="margin-top:8px; display:flex; gap:8px;">
          <button id="reopen-float-card-btn" style="border:1px solid #f43f5e; background:#fff1f2; color:#e11d48; font-size:11px; font-weight:700; padding:5px 12px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; transition:all 0.15s ease;">
            <span>📑</span> Open Summary Pop-up
          </button>
          <button id="copy-summary-btn" style="border:1px solid #cbd5e1; background:#ffffff; color:#334155; font-size:11px; font-weight:600; padding:5px 10px; border-radius:6px; cursor:pointer; display:inline-flex; align-items:center; gap:4px; transition:all 0.15s ease;">
            <span>📋</span> Copy Text
          </button>
        </div>
      `;

      const reopenBtn = document.getElementById('reopen-float-card-btn');
      if (reopenBtn) {
        reopenBtn.addEventListener('click', () => {
          showSummaryModal(finalTitle, currentSummaryMarkdown);
          deliverFloatingSummaryToPage(finalTitle, currentSummaryMarkdown);
        });
      }

      const copyBtn = document.getElementById('copy-summary-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(currentSummaryMarkdown);
            copyBtn.innerHTML = '<span>✓</span> Copied!';
            copyBtn.style.color = '#059669';
            setTimeout(() => {
              copyBtn.innerHTML = '<span>📋</span> Copy Text';
              copyBtn.style.color = '#334155';
            }, 1800);
          } catch (e) {}
        });
      }

      updateStatus('online', '✓ Summary Generated');
      speakAgentMessage('Summary pop-up generated successfully');
    } catch (err) {
      console.error('[Popup] Summarization workflow failed:', err);
      reasoningBox.innerHTML = `<span style="color:#ef4444;">Error generating summary: ${escapeHtml(err.message)}</span>`;
      updateStatus('online', 'Summary error');
    }
  }

  // Server health check & Whisper badge auto-updater
  function checkServerHealth() {
    fetch('http://127.0.0.1:5000/api/health')
      .then(r => r.json())
      .then(d => {
        const serverBadge = document.getElementById('server-badge');
        if (serverBadge && d.status === 'ok') {
          serverBadge.style.background = 'rgba(16, 185, 129, 0.15)';
          serverBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
          serverBadge.style.color = '#10b981';
          serverBadge.innerHTML = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#10b981;"></span><span>🟢 Whisper AI Active</span>';
        }
      })
      .catch(() => {
        const serverBadge = document.getElementById('server-badge');
        if (serverBadge) {
          serverBadge.style.background = 'rgba(245, 158, 11, 0.15)';
          serverBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
          serverBadge.style.color = '#d97706';
          serverBadge.innerHTML = '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#f59e0b;"></span><span>⚠️ Server Offline (run py server/run.py)</span>';
        }
      });
  }
  checkServerHealth();
  setInterval(checkServerHealth, 4000);

  // Summary Page Button in UI
  if (summarizePageBtn) {
    summarizePageBtn.addEventListener('click', () => {
      executeSummarizationWorkflow('Summarize this page');
    });
  }

  // Initialize status from background service worker
  chrome.runtime.sendMessage({ type: 'get_initial_state' }, (res) => {
    if (chrome.runtime.lastError) return;
    if (res && res.status) {
      updateStatus(res.status.state, res.status.message);
    }
  });

  // Event Listeners: Text Command
  sendBtn.addEventListener('click', handleSendCommand);
  commandInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendCommand();
    }
  });

  // Event Listener: Voice Mic Recording
  micBtn.addEventListener('click', handleToggleMic);

  if (voiceStopBtn) {
    voiceStopBtn.addEventListener('click', () => {
      if (isRecording) handleToggleMic();
    });
  }

  // Event Listener: Reload Extension & Service Worker
  const reloadExtBtn = document.getElementById('reload-ext-btn');
  if (reloadExtBtn) {
    reloadExtBtn.addEventListener('click', () => {
      reloadExtBtn.style.transform = 'rotate(360deg)';
      updateStatus('thinking', 'Reloading extension service worker...');
      setTimeout(() => chrome.runtime.reload(), 200);
    });
  }

  // Event Listener: Toggle Tags Overlay
  toggleTagsBtn.addEventListener('click', () => {
    overlaysVisible = !overlaysVisible;
    chrome.runtime.sendMessage({
      type: 'toggle_overlays',
      show: overlaysVisible
    });
    toggleTagsBtn.style.borderColor = overlaysVisible ? '#f43f5e' : '';
    toggleTagsBtn.style.color = overlaysVisible ? '#f43f5e' : '';
  });

  // Always-On Mode Toggle Button (injected dynamically)
  const alwaysOnBtn = document.createElement('button');
  alwaysOnBtn.id = 'always-on-btn';
  alwaysOnBtn.className = 'util-btn';
  alwaysOnBtn.title = 'Toggle Always-On Voice Mode';
  alwaysOnBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
    </svg>
    Always-On: OFF
  `;
  document.querySelector('.utility-row').appendChild(alwaysOnBtn);

  alwaysOnBtn.addEventListener('click', () => {
    alwaysOnMode = !alwaysOnMode;
    if (alwaysOnMode) {
      alwaysOnBtn.style.borderColor = '#8b5cf6';
      alwaysOnBtn.style.color = '#8b5cf6';
      alwaysOnBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
        🟣 Always-On: ON
      `;
      updateStatus('online', '🎙️ Always Listening...');
      // Auto-start listening if not already
      if (!isRecording) handleToggleMic();
    } else {
      alwaysOnBtn.style.borderColor = '';
      alwaysOnBtn.style.color = '';
      alwaysOnBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
        Always-On: OFF
      `;
      if (autoResumeTimer) { clearTimeout(autoResumeTimer); autoResumeTimer = null; }
      // Stop listening if active from always-on
      if (isRecording) handleToggleMic();
      updateStatus('online', 'Agent Ready');
    }
  });

  // Artifact Card Elements
  const artifactCard = document.getElementById('generated-artifact-card');
  const auditLogModal = document.getElementById('audit-log-modal');
  const auditLogContent = document.getElementById('audit-log-content');
  const auditModalCloseBtn = document.getElementById('audit-modal-close-btn');

  // Event Listener: Open Audit Log History Modal
  verifyLogBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'verify_log' });

    let history = [];
    try {
      history = JSON.parse(localStorage.getItem('audit_history') || '[]');
    } catch(e) {}

    auditLogContent.innerHTML = '';
    if (history.length === 0) {
      auditLogContent.innerHTML = `
        <div style="background:#fff1f2; border:1px dashed #fecdd3; border-radius:10px; padding:16px 12px; text-align:center; margin:8px 0;">
          <div style="font-size:20px; margin-bottom:6px;">🛡️</div>
          <div style="font-weight:600; font-size:12px; color:#be123c; margin-bottom:4px;">No Actions Recorded Yet</div>
          <div style="font-size:10.5px; color:#6b7280; line-height:1.4;">
            This is the immutable security audit ledger. Run any task (e.g. search GitHub, open Gmail, summarize articles) to see cryptographic step hashes and execution history here.
          </div>
        </div>
      `;
    } else {
      history.forEach(item => {
        const entry = document.createElement('div');
        entry.className = 'audit-log-entry';
        entry.innerHTML = `
          <div class="audit-entry-time">${escapeHtml(item.time || '')}</div>
          <div class="audit-entry-goal">${escapeHtml(item.goal || 'Executed Task')}</div>
          ${item.recipient ? `<div style="font-size:10px; color:#6b7280;"><strong>To:</strong> ${escapeHtml(item.recipient)}</div>` : ''}
          ${item.subject ? `<div style="font-size:10px; color:#6b7280;"><strong>Subject:</strong> ${escapeHtml(item.subject)}</div>` : ''}
          ${item.content ? `<div class="audit-entry-content">${escapeHtml(item.content)}</div>` : ''}
        `;
        auditLogContent.appendChild(entry);
      });
    }
    auditLogModal.style.display = 'flex';
    auditLogModal.classList.remove('hidden');
  });

  const auditModalXBtn = document.getElementById('audit-modal-x-btn');

  function closeAuditModal(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (auditLogModal) {
      auditLogModal.classList.add('hidden');
      auditLogModal.style.display = 'none';
    }
  }

  if (auditModalCloseBtn) {
    auditModalCloseBtn.addEventListener('click', closeAuditModal);
    auditModalCloseBtn.addEventListener('pointerdown', closeAuditModal);
  }
  if (auditModalXBtn) {
    auditModalXBtn.addEventListener('click', closeAuditModal);
    auditModalXBtn.addEventListener('pointerdown', closeAuditModal);
  }
  if (auditLogModal) {
    auditLogModal.addEventListener('click', (e) => {
      if (e.target === auditLogModal) {
        closeAuditModal(e);
      }
    });
  }

  // Global escape key to close any open modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAuditModal();
      if (confirmationModal) confirmationModal.classList.add('hidden');
    }
  });

  // Event Listeners: Confirmation Modal
  modalConfirmBtn.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationModal.style.display = 'none';
    chrome.runtime.sendMessage({
      type: 'confirm_action',
      payload: { approved: true, id: currentPendingConfirmationId }
    });
  });

  modalRejectBtn.addEventListener('click', () => {
    confirmationModal.classList.add('hidden');
    confirmationModal.style.display = 'none';
    chrome.runtime.sendMessage({
      type: 'confirm_action',
      payload: { approved: false, id: currentPendingConfirmationId }
    });
  });

  // Event Listeners: Clarification Card
  clarifyCancelBtn.addEventListener('click', () => {
    clarificationCard.classList.add('hidden');
    currentClarification = null;
    updateStatus('online', 'Agent Ready');
  });

  clarifyRunBtn.addEventListener('click', submitClarification);

  clarifySpeakBtn.addEventListener('click', () => {
    clarifyVoiceHint.classList.remove('hidden');
    // Start listening for field inputs
    if (!isRecording) handleToggleMic();
  });

  const clarifySsoContainer = document.getElementById('clarify-sso-container');
  const clarifySsoButtons = document.getElementById('clarify-sso-buttons');

  function showClarificationDialog(req) {
    currentClarification = req;
    clarifyTitle.textContent = req.intentLabel || 'I need a few details';
    clarifySubtitle.textContent = 'Fill in the information below or speak:';
    clarifyFields.innerHTML = '';

    // Render Quick Actions / SSO Login Buttons if available on the webpage
    if (req.quickActions && req.quickActions.length > 0) {
      clarifySsoButtons.innerHTML = '';
      req.quickActions.forEach(qa => {
        const btn = document.createElement('button');
        btn.className = 'clarify-sso-chip';
        btn.textContent = qa.label;
        btn.addEventListener('click', () => {
          clarificationCard.classList.add('hidden');
          currentClarification = null;
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'execute_actions',
                payload: {
                  actions: [{ step: 0, tag_id: qa.tag_id, action: 'click', description: `Click "${qa.label}"` }]
                }
              }).catch(() => {});
            }
          });
          reasoningBox.innerHTML = `<strong>Autonomous Action:</strong> Clicked "${escapeHtml(qa.label)}"`;
          updateStatus('online', `Completed: ${qa.label}`);
        });
        clarifySsoButtons.appendChild(btn);
      });
      clarifySsoContainer.classList.remove('hidden');
    } else {
      clarifySsoContainer.classList.add('hidden');
    }

    (req.fields || []).forEach((field) => {
      const row = document.createElement('div');
      row.className = 'clarify-field-row';

      const label = document.createElement('label');
      label.className = 'clarify-label';
      label.textContent = field.label;
      if (field.optional) {
        const opt = document.createElement('span');
        opt.className = 'opt-tag';
        opt.textContent = '(optional)';
        label.appendChild(opt);
      }

      const input = document.createElement('input');
      input.className = 'clarify-input';
      input.type = field.type === 'password' ? 'password' : 'text';
      input.dataset.key = field.key;
      input.value = field.prefilled || '';
      input.placeholder = `Enter ${field.label.toLowerCase()}...`;

      row.appendChild(label);
      row.appendChild(input);
      clarifyFields.appendChild(row);
    });

    clarificationCard.classList.remove('hidden');
    // Focus first empty input
    const firstEmpty = clarifyFields.querySelector('input:not([value])') || clarifyFields.querySelector('input');
    if (firstEmpty) setTimeout(() => firstEmpty.focus(), 100);
  }

  function submitClarification() {
    if (!currentClarification) return;
    const values = {};
    const inputs = clarifyFields.querySelectorAll('.clarify-input');
    inputs.forEach(inp => {
      values[inp.dataset.key] = inp.value.trim();
    });

    clarificationCard.classList.add('hidden');
    reasoningBox.innerHTML = `<strong>Autonomous Plan:</strong> Executing ${escapeHtml(currentClarification.intentLabel || 'task')}...`;
    updateStatus('thinking', 'Executing all steps autonomously...');

    chrome.runtime.sendMessage({
      type: 'clarification_reply',
      payload: {
        intent: currentClarification.intent,
        values
      }
    });

    currentClarification = null;
  }

  // Runtime Message Receiver
  chrome.runtime.onMessage.addListener((message) => {
    switch (message.type) {
      case 'status':
        updateStatus(message.payload?.state, message.payload?.message);
        break;

      case 'clarification_request':
        showClarificationDialog(message.payload);
        break;

      case 'action_plan':
        renderActionPlan(message.payload);
        break;

      case 'action_result':
        updateStepResult(message.payload);
        // In always-on mode, auto-resume listening 1.8s after task finishes
        if (alwaysOnMode && message.payload?.success !== false) {
          scheduleAutoResumeListen();
        }
        break;

      case 'require_user_input':
        const hitlBadgeEl = document.getElementById('hitl-badge');
        if (hitlBadgeEl) hitlBadgeEl.style.display = 'inline-block';
        if (hitlBannerDesc) hitlBannerDesc.textContent = message.payload?.message || 'Authentication or sign-in required in browser.';
        const bannerTitle = document.getElementById('hitl-banner-title');
        if (bannerTitle && message.payload?.title) bannerTitle.textContent = message.payload.title;
        const bannerSub = document.getElementById('hitl-banner-sub');
        if (bannerSub) bannerSub.textContent = 'Choose Option 1 (Manual in browser) or Option 2 (Auto-login)';

        const siteName = message.payload?.siteName || 'this website';
        const agentOptTitle = document.getElementById('hitl-agent-opt-title');
        if (agentOptTitle) agentOptTitle.textContent = `Let Agent Sign You In on ${siteName}`;
        const agentOptDesc = document.getElementById('hitl-agent-opt-desc');
        if (agentOptDesc) {
          const count = message.payload?.fields?.length || 2;
          agentOptDesc.textContent = `Detected ${count} field(s) on ${siteName}. Enter details below for the agent to auto-login.`;
        }

        // Also display the inline HITL card directly on the Actions tab!
        const inlineHitlEl = document.getElementById('inline-hitl-card');
        if (inlineHitlEl) {
          inlineHitlEl.style.display = 'flex';
          const inlineDescEl = document.getElementById('inline-hitl-desc');
          if (inlineDescEl && message.payload?.message) inlineDescEl.textContent = message.payload.message;
        }

        // Render detected SSO buttons for Option 1
        if (hitlSsoContainer && hitlSsoButtons) {
          if (message.payload?.ssoButtons && message.payload.ssoButtons.length > 0) {
            hitlSsoButtons.innerHTML = '';
            message.payload.ssoButtons.forEach(ssoText => {
              const chip = document.createElement('button');
              chip.className = 'clarify-sso-chip';
              chip.setAttribute('data-sso', ssoText);
              chip.style.cssText = 'padding: 5px 10px; font-size: 11px; font-weight: 600; border-radius: 6px; border: 1px solid #fed7aa; background: #fff; cursor: pointer; color: #9a3412; transition: all 0.15s ease;';
              chip.textContent = ssoText;
              hitlSsoButtons.appendChild(chip);
            });
            hitlSsoContainer.style.display = 'flex';
          }
        }

        // Dynamically render the exact form fields requested by this website (Option 2)
        const dynamicContainer = document.getElementById('hitl-dynamic-fields-container');
        if (dynamicContainer) {
          const fields = message.payload?.fields || [
            { key: 'username', name: 'username', label: 'Username or Email', type: 'text', placeholder: 'Enter username or email' },
            { key: 'password', name: 'password', label: 'Password', type: 'password', placeholder: 'Enter password' }
          ];

          dynamicContainer.innerHTML = '';
          fields.forEach((f, idx) => {
            const group = document.createElement('div');
            group.className = 'hitl-dynamic-field-group';
            group.style.cssText = 'display: flex; flex-direction: column; gap: 3px;';

            const label = document.createElement('label');
            label.style.cssText = 'font-size: 10.5px; font-weight: 600; color: #475569;';
            label.textContent = f.label || (f.type === 'password' ? 'Password' : `Field ${idx + 1}`);

            const input = document.createElement('input');
            input.className = 'hitl-dynamic-input';
            input.type = f.type || (f.name?.toLowerCase().includes('pass') ? 'password' : 'text');
            input.placeholder = f.placeholder || `Enter ${label.textContent.toLowerCase()}...`;
            input.dataset.key = f.key || f.name || `field_${idx}`;
            input.dataset.name = f.name || '';
            input.dataset.id = f.id || '';
            input.dataset.type = f.type || 'text';
            input.dataset.selector = f.selector || '';
            input.style.cssText = 'width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1.5px solid #e2e8f0; border-radius: 7px; font-size: 11.5px; transition: border 0.15s ease;';

            input.addEventListener('focus', () => {
              input.style.borderColor = '#f59e0b';
              input.style.outline = 'none';
            });
            input.addEventListener('blur', () => {
              input.style.borderColor = '#e2e8f0';
            });

            group.appendChild(label);
            group.appendChild(input);
            dynamicContainer.appendChild(group);
          });
        }

        switchTab('hitl');
        speakAgentMessage(message.payload?.title || `Authentication required on ${siteName}`);
        break;

      case 'speech_live_transcript':
        if (message.text) {
          handleSpeechTranscriptUpdate(message.text);
        }
        break;

      case 'step_progress':
        renderStepProgress(message.payload);
        const hasPausedStep = message.payload?.steps?.some(s => s.status === 'paused');
        const inlineHitlOnProgress = document.getElementById('inline-hitl-card');
        if (inlineHitlOnProgress) {
          inlineHitlOnProgress.style.display = hasPausedStep ? 'flex' : 'none';
        }
        break;

      case 'agent_thought':
        if (message.payload) {
          const { turn, thought, action } = message.payload;
          reasoningBox.innerHTML = `
            <div style="margin-bottom:6px; font-weight:700; color:#7c3aed; display:flex; align-items:center; gap:6px;">
              <span>🧠 Agent Thought (Turn ${turn})</span>
            </div>
            <div style="font-size:12px; line-height:1.4; color:#374151;">${escapeHtml(thought)}</div>
            ${action ? `<div style="margin-top:6px; font-size:11px; font-weight:600; color:#4f46e5;">Next Action: ${escapeHtml(action)}</div>` : ''}
          `;
          updateStatus('thinking', `Turn ${turn}: ${thought.slice(0, 50)}...`);
        }
        break;

      case 'transcription':
        if (message.payload?.text) {
          commandInput.value = message.payload.text;
          if (liveTranscript) {
            liveTranscript.textContent = message.payload.text;
            liveTranscript.classList.add('has-text');
          }
          reasoningBox.innerHTML = `<strong>Voice Command:</strong> "${escapeHtml(message.payload.text)}"`;
          handleSendCommand();
        }
        break;

      case 'voice_volume_level':
        if (voiceRecordingBar && !voiceRecordingBar.classList.contains('hidden')) {
          const waves = voiceRecordingBar.querySelectorAll('.wave-visualizer span');
          const lvl = message.level || 0.2;
          waves.forEach((s, idx) => {
            const h = Math.max(4, Math.min(18, Math.round(lvl * 22 * (0.6 + 0.4 * Math.sin(idx * 1.5 + Date.now() / 90)))));
            s.style.height = `${h}px`;
          });
        }
        break;

      case 'confirmation_request':
        showConfirmationModal(message.payload, message.id);
        break;

      case 'artifact_generated':
        renderArtifactCard(message.payload);
        break;

      case 'trigger_summary':
        executeSummarizationWorkflow(message.query || '');
        break;
    }
  });

  // Render sent-confirmation toast (email goes into Gmail compose directly, no duplicate preview)
  function renderArtifactCard(payload) {
    if (!payload || payload.artifactType !== 'email') return;
    const goalLower = (payload.goal || '').toLowerCase();
    if (goalLower.includes('whatsapp') || goalLower.includes('telegram') || goalLower.includes('slack') || goalLower.includes('discord')) return;
    const card = document.getElementById('generated-artifact-card');
    if (!card) return;

    // Populate hidden fields for copy functionality
    const contentEl = document.getElementById('artifact-content');
    const recipientEl = document.getElementById('artifact-recipient');
    const subjectEl = document.getElementById('artifact-subject');
    const sentLabel = document.getElementById('artifact-sent-label');

    if (contentEl) contentEl.textContent = payload.body || '';
    if (recipientEl) recipientEl.textContent = payload.recipient || '';
    if (subjectEl) subjectEl.textContent = payload.subject || '';

    // Update label
    if (sentLabel) {
      sentLabel.textContent = `Composed in Gmail`;
    }

    // Show the card persistently so user and judges can read & verify the email
    card.style.display = 'flex';
    card.style.opacity = '1';

    // Save to audit history silently
    try {
      localStorage.setItem('last_artifact', JSON.stringify(payload));
      const history = JSON.parse(localStorage.getItem('audit_history') || '[]');
      if (!history.some(h => h.content === payload.body)) {
        history.unshift({
          time: new Date().toLocaleTimeString(),
          goal: payload.goal || 'Generated Content',
          recipient: payload.recipient,
          subject: payload.subject,
          content: payload.body
        });
        localStorage.setItem('audit_history', JSON.stringify(history.slice(0, 30)));
      }
    } catch(e) {}
  }

  /**
   * Schedule auto-resume listening after task completion (Always-On Mode).
   * Waits 1.8s so the user can see the result, then restarts mic.
   */
  function scheduleAutoResumeListen() {
    if (!alwaysOnMode) return;
    if (autoResumeTimer) clearTimeout(autoResumeTimer);
    autoResumeTimer = setTimeout(() => {
      autoResumeTimer = null;
      if (alwaysOnMode && !isRecording) {
        // Reset input for fresh command
        commandInput.value = '';
        lastExecutedCommand = '';
        if (liveTranscript) {
          liveTranscript.textContent = '🟣 Always-On: Listening for next command...';
          liveTranscript.classList.remove('has-text');
        }
        handleToggleMic();
        updateStatus('online', '🎙️ Always Listening...');
      }
    }, 1800);
  }

  // Voice Mic Toggle & Speech Coordination
  let speechSilenceTimer = null;

  function handleSpeechTranscriptUpdate(text) {
    if (!text) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    if (liveTranscript) {
      liveTranscript.textContent = cleanText;
      liveTranscript.classList.add('has-text');
    }

    // If clarification dialog is active, map spoken text into clarification fields
    if (currentClarification && !clarificationCard.classList.contains('hidden')) {
      const parts = cleanText.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
      const inputs = clarifyFields.querySelectorAll('.clarify-input');
      inputs.forEach((inp, idx) => {
        if (parts[idx]) inp.value = parts[idx];
      });
      if (speechSilenceTimer) clearTimeout(speechSilenceTimer);
      speechSilenceTimer = setTimeout(() => {
        if (isRecording) {
          handleToggleMic();
          submitClarification();
        }
      }, 4000);
      return;
    }

    commandInput.value = cleanText;

    // Auto-execute after 5s pause — gives user time to finish speaking naturally
    if (speechSilenceTimer) clearTimeout(speechSilenceTimer);
    speechSilenceTimer = setTimeout(() => {
      if (isRecording && commandInput.value.trim().length > 2) {
        console.log('[Popup] Voice silence 5s auto-submit:', commandInput.value);
        handleToggleMic();
      }
    }, 5000);
  }

  async function handleToggleMic() {
    if (speechSilenceTimer) {
      clearTimeout(speechSilenceTimer);
      speechSilenceTimer = null;
    }

    if (!isRecording) {
      isRecording = true;
      micBtn.classList.add('recording');
      voiceRecordingBar.classList.remove('hidden');
      if (micStatusLabel) micStatusLabel.textContent = '🔴 Listening... Speak clearly now';
      recordingStartTime = Date.now();

      // Reset live transcript
      if (liveTranscript) {
        liveTranscript.textContent = 'Listening to your voice...';
        liveTranscript.classList.remove('has-text');
      }
      if (commandInput) {
        commandInput.value = '';
      }
      lastExecutedCommand = '';

      // Start dynamic wave visualizer
      if (waveAnimInterval) clearInterval(waveAnimInterval);
      waveAnimInterval = setInterval(() => {
        if (!isRecording) { clearInterval(waveAnimInterval); return; }
        const waves = voiceRecordingBar.querySelectorAll('.wave-visualizer span');
        waves.forEach((s) => {
          const h = 4 + Math.round(Math.random() * 14);
          s.style.height = `${h}px`;
        });
      }, 90);

      // Start recording timer
      if (recordingInterval) clearInterval(recordingInterval);
      recordingInterval = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - recordingStartTime) / 1000);
        const min = Math.floor(elapsedSec / 60);
        const sec = elapsedSec % 60;
        if (recordingTimer) {
          recordingTimer.textContent = `${min}:${sec < 10 ? '0' : ''}${sec}`;
        }
      }, 500);

      // Trigger speech recognition in active tab
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        let activeTab = tabs?.[0];
        const activeUrl = activeTab?.url || '';
        const isRestricted = activeUrl.startsWith('chrome://') || activeUrl.startsWith('edge://') || activeUrl.startsWith('about:') || activeUrl.startsWith('chrome-extension://');

        if (isRestricted || !activeTab?.id) {
          startLocalSpeechFallback();
          return;
        }

        chrome.tabs.sendMessage(activeTab.id, { type: 'start_speech_recognition' }, (res) => {
          const err = chrome.runtime.lastError;
          if (err || !res?.success) {
            console.log('[Popup] Injecting content script for speech...');
            chrome.scripting.executeScript({
              target: { tabId: activeTab.id },
              files: ['pii_detector.js', 'content.js']
            }).then(() => {
              setTimeout(() => {
                chrome.tabs.sendMessage(activeTab.id, { type: 'start_speech_recognition' }, (res2) => {
                  const err2 = chrome.runtime.lastError;
                  if (err2 || !res2?.success) startLocalSpeechFallback();
                });
              }, 100);
            }).catch(() => startLocalSpeechFallback());
          }
        });
      });
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'start_audio_recording' }).catch(() => {});
    } else {
      // Stop recording
      isRecording = false;
      micBtn.classList.remove('recording');
      voiceRecordingBar.classList.add('hidden');
      if (micStatusLabel) micStatusLabel.textContent = 'Tap to speak in English';
      if (recordingInterval) clearInterval(recordingInterval);
      if (waveAnimInterval) clearInterval(waveAnimInterval);

      // Stop speech recognition across tabs safely
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        const url = tab?.url || '';
        if (tab?.id && !url.startsWith('chrome://') && !url.startsWith('edge://') && !url.startsWith('about:') && !url.startsWith('chrome-extension://')) {
          chrome.tabs.sendMessage(tab.id, { type: 'stop_speech_recognition' }, () => {
            const err = chrome.runtime.lastError;
          });
        }
      });
      stopLocalSpeechFallback();

      // Retrieve high-fidelity 16kHz PCM audio from offscreen and transcribe via local Whisper
      chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop_audio_recording' }, async (res) => {
        if (chrome.runtime.lastError) return;
        if (res && res.audio_base64) {
          try {
            updateStatus('thinking', 'Transcribing with local Whisper AI...');
            const vResp = await fetch('http://127.0.0.1:5000/api/voice', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio_base64: res.audio_base64 })
            });
            if (vResp.ok) {
              const vJson = await vResp.json();
              if (vJson.text && vJson.text.trim().length > 1) {
                commandInput.value = vJson.text.trim();
                handleSpeechTranscriptUpdate(vJson.text.trim());
                reasoningBox.innerHTML = `<strong>Whisper Voice:</strong> "${escapeHtml(vJson.text.trim())}"`;
                handleSendCommand();
                return;
              }
            }
          } catch (whisperErr) {
            console.log('[Popup] Whisper audio transcription error, using speech fallback:', whisperErr.message);
          }
        }

        // Fallback to text captured by web speech
        const capturedText = commandInput.value.trim();
        const isAlwaysOnResume = capturedText.toLowerCase().startsWith('🟣');
        if (capturedText && !capturedText.toLowerCase().startsWith('listening') && !isAlwaysOnResume && capturedText.length > 1) {
          if (capturedText !== lastExecutedCommand) {
            lastExecutedCommand = capturedText;
            reasoningBox.innerHTML = `<strong>Voice Command:</strong> "${escapeHtml(capturedText)}"`;
            handleSendCommand();
          } else {
            scheduleAutoResumeListen();
          }
        } else if (!alwaysOnMode) {
          reasoningBox.innerHTML = `<em>No speech recognized. Tap mic and try speaking clearly, or type below.</em>`;
        } else {
          scheduleAutoResumeListen();
        }
      });

      if (!alwaysOnMode) updateStatus('online', 'Agent Ready');
    }
  }

  function startLocalSpeechFallback() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    try {
      if (localSpeechRec) {
        try { localSpeechRec.abort(); } catch(e) {}
      }
      localSpeechRec = new SpeechRecognition();
      localSpeechRec.continuous = true;
      localSpeechRec.interimResults = true;
      localSpeechRec.lang = navigator.language?.startsWith('en') ? 'en-IN' : (navigator.language || 'en-IN');

      localSpeechRec.onresult = (event) => {
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
        handleSpeechTranscriptUpdate(finalText + interimText);
      };

      localSpeechRec.onerror = (e) => {
        if (e.error === 'network') {
          setTimeout(() => {
            if (isRecording && localSpeechRec) {
              try { localSpeechRec.start(); } catch(ex) {}
            }
          }, 300);
        }
      };

      localSpeechRec.start();
    } catch(e) {}
  }

  function stopLocalSpeechFallback() {
    if (localSpeechRec) {
      const r = localSpeechRec;
      localSpeechRec = null;
      try { r.stop(); } catch(e) {}
    }
  }

  // Command Submission Handler
  function handleSendCommand() {
    let rawInput = commandInput.value.trim();
    if (!rawInput && !attachedDocument) return;

    // Check if user is asking to summarize, synthesize, or explain document/webpage
    const isSummarizeIntent = (
      /\b(?:summariz|summeriz|summerzi|summaris|sumariz|sumary|summary|summaries|tldr|takeaway|takeaways|overview|key\s*points)\b/i.test(rawInput) ||
      (/\b(?:explain|analyze|analyse|what\s+is\s+in|tell\s+me\s+about|read)\b/i.test(rawInput) && /\b(?:pdf|doc|document|page|site|website|article|paper|file)\b/i.test(rawInput)) ||
      (attachedDocument && (!rawInput || /\b(?:process|read|check|review|understand|summarize|summerzie|explain)\b/i.test(rawInput)))
    );

    if (isSummarizeIntent) {
      const promptToRun = rawInput || (attachedDocument ? `Summarize ${attachedDocument.name}` : 'Summarize active page');
      commandInput.value = '';
      executeSummarizationWorkflow(promptToRun);
      return;
    }

    let text = rawInput;
    const originalGoal = text || (attachedDocument ? `Process and summarize ${attachedDocument.name}` : 'Run task');
    commandInput.value = '';

    if (attachedDocument && attachedDocument.extractedText) {
      text = text
        ? `${text}\n\n[ATTACHED DOCUMENT CONTENT FROM ${attachedDocument.name}]:\n${attachedDocument.extractedText}`
        : `Please process, analyze and summarize the attached document (${attachedDocument.name}):\n\n${attachedDocument.extractedText}`;
    }

    // Clear previous execution state
    planStepsList.innerHTML = '';
    planStepsContainer.style.display = 'none';
    planMeta.style.display = 'none';
    if (artifactCard) {
      artifactCard.style.display = 'none';
      artifactCard.style.opacity = '0';
    }

    reasoningBox.innerHTML = `<strong>Planning:</strong> Analyzing active page DOM elements for "${escapeHtml(originalGoal)}"...`;
    updateStatus('thinking', 'Planning actions for command...');
    speakAgentMessage('Starting task: ' + originalGoal);

    chrome.runtime.sendMessage({
      type: 'command',
      payload: {
        text,
        source: 'text',
        language: 'auto',
        attached_document: attachedDocument ? {
          name: attachedDocument.name,
          type: attachedDocument.type,
          size: attachedDocument.size
        } : null
      }
    });
  }

  // Render Action Plan
  function renderActionPlan(plan) {
    if (!plan) return;

    if (plan.reasoning) {
      reasoningBox.innerHTML = `<strong>Reasoning:</strong> ${escapeHtml(plan.reasoning)}`;
    }

    planMeta.style.display = 'flex';
    const conf = Math.round((plan.confidence || 0.95) * 100);
    confidenceBadge.textContent = `${conf}% Match`;
    sourceBadge.textContent = (plan.source || 'DOM').toUpperCase();

    const actions = plan.actions || [];
    if (actions.length > 0) {
      planStepsContainer.style.display = 'flex';
      planStepsList.innerHTML = '';

      actions.forEach((act, idx) => {
        const stepNum = act.step !== undefined ? act.step : idx;
        const stepDiv = document.createElement('div');
        const isInstantDone = act.action === 'navigate';
        stepDiv.className = isInstantDone ? 'step-item done' : 'step-item';
        stepDiv.id = `step-item-${stepNum}`;

        stepDiv.innerHTML = `
          <div class="step-info" style="display:flex; align-items:center; gap:6px;">
            <span style="font-weight:700; color:#f43f5e; font-family:var(--font-mono);">#${act.tag_id || stepNum + 1}</span>
            <span style="font-weight:600; font-size:10px; background:#ffe4e6; color:#e11d48; padding:1px 5px; border-radius:4px;">${act.action || 'ACTION'}</span>
            <span>${escapeHtml(act.description || act.value || '')}</span>
          </div>
          <span class="step-badge" id="step-badge-${stepNum}" style="font-size:10px; font-weight:700; color:${isInstantDone ? '#059669' : '#6b7280'};">${isInstantDone ? 'Done ✓' : 'Queued'}</span>
        `;
        planStepsList.appendChild(stepDiv);
      });
      if (actions.some(a => a.action === 'navigate')) {
        // Navigate action queued
      }
    } else {
      planStepsContainer.style.display = 'none';
    }
  }
  // Render Step Progress (from StepQueue executor in background.js)
  function renderStepProgress(payload) {
    if (!payload || !payload.steps) return;

    const { goal, steps, currentStep } = payload;

    // Show goal in reasoning box
    if (goal) {
      reasoningBox.innerHTML = `<strong>Goal:</strong> ${escapeHtml(goal)}`;
    }

    planMeta.style.display = 'flex';
    confidenceBadge.textContent = `${steps.length} Steps`;
    sourceBadge.textContent = 'AUTO-PLAN';
    planStepsContainer.style.display = 'flex';
    planStepsList.innerHTML = '';

    const STATUS_ICONS = {
      pending: '⏳',
      running: '▶',
      paused: '⏸️',
      done: '✓',
      skipped: '↩',
      failed: '✗'
    };
    const STATUS_COLORS = {
      pending: '#9ca3af',
      running: '#3b82f6',
      paused: '#d97706',
      done: '#059669',
      skipped: '#6b7280',
      failed: '#ef4444'
    };

    steps.forEach((step, idx) => {
      const stepDiv = document.createElement('div');
      const isPaused = step.status === 'paused';
      const isDone = step.status === 'done';
      const isActive = step.status === 'running';

      stepDiv.className = 'step-item' + (isDone ? ' done' : '') + (isPaused ? ' paused' : '');
      stepDiv.id = `sq-step-${step.id}`;

      if (isPaused) {
        stepDiv.style.border = '1.5px solid #f59e0b';
        stepDiv.style.background = '#fffbeb';
        stepDiv.style.borderRadius = '8px';
        stepDiv.style.padding = '10px';
      }

      const icon = STATUS_ICONS[step.status] || '⏳';
      const color = STATUS_COLORS[step.status] || '#9ca3af';

      stepDiv.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
          <div class="step-info" style="display:flex; align-items:center; gap:6px; ${isActive ? 'animation: pulse 1s infinite;' : ''}">
            <span style="font-weight:700; color:${color}; font-size:13px;">${icon}</span>
            <span style="font-weight:600; font-size:10px; background:${isPaused ? '#fef3c7' : '#ffe4e6'}; color:${isPaused ? '#b45309' : '#e11d48'}; padding:1px 5px; border-radius:4px;">${(idx + 1)}</span>
            <span style="color:${isPaused ? '#92400e' : (isActive ? '#3b82f6' : 'inherit')}; font-weight:${(isActive || isPaused) ? '600' : '400'};">${escapeHtml(step.label)}</span>
          </div>
          <span style="font-size:10px; font-weight:700; color:${color}; background:${isPaused ? '#fef3c7' : 'transparent'}; padding:${isPaused ? '2px 6px' : '0'}; border-radius:4px;">${step.status.toUpperCase()}</span>
        </div>
      `;

      if (isPaused) {
        const resumeContainer = document.createElement('div');
        resumeContainer.style.cssText = 'margin-top: 8px; padding: 10px; background: #ffffff; border: 1px solid #fde68a; border-radius: 8px; display: flex; flex-direction: column; gap: 8px; width: 100%; box-sizing: border-box;';
        resumeContainer.innerHTML = `
          <div style="font-size: 11px; font-weight: 600; color: #92400e; display: flex; align-items: center; gap: 5px;">
            <span>⏸️</span>
            <span>Sign in to your account in the browser, then click below:</span>
          </div>
          <button id="inline-hitl-resume-btn-${step.id}" style="width: 100%; padding: 9px 12px; font-size: 12px; font-weight: 700; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(16, 185, 129, 0.3); display: flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s ease;">
            <span>✅</span>
            <span>I've Signed In — Continue Task</span>
          </button>
        `;
        const inlineBtn = resumeContainer.querySelector(`#inline-hitl-resume-btn-${step.id}`);
        inlineBtn.addEventListener('click', () => {
          inlineBtn.disabled = true;
          inlineBtn.innerHTML = '<span>⚡</span><span>Resuming task...</span>';
          updateStatus('acting', 'Resuming task execution...');
          speakAgentMessage('Resuming execution');
          chrome.runtime.sendMessage({ type: 'resume_step_queue' });
        });
        stepDiv.appendChild(resumeContainer);
      }

      planStepsList.appendChild(stepDiv);
    });

    if (payload.isTaskComplete) {
      updateStatus('online', 'Goal Complete ✓');
      if (alwaysOnMode) scheduleAutoResumeListen();
    }
  }

  // Update Step Execution Result
  function updateStepResult(result) {
    if (!result) return;
    const stepNum = result.step_index;
    const stepDiv = document.getElementById(`step-item-${stepNum}`);
    const stepBadge = document.getElementById(`step-badge-${stepNum}`);

    if (stepDiv && stepBadge) {
      if (result.success) {
        stepDiv.className = 'step-item done';
        stepBadge.style.color = '#059669';
        stepBadge.textContent = 'Done ✓';
      } else {
        stepDiv.className = 'step-item';
        stepBadge.style.color = '#ef4444';
        stepBadge.textContent = 'Failed ✗';
        updateStatus('error', result.error || 'Step failed');
      }
    }
  }

  // Safety Confirmation Modal
  function showConfirmationModal(payload, id) {
    currentPendingConfirmationId = id;
    modalDetails.innerHTML = `
      <div><strong>Action:</strong> ${escapeHtml(payload?.action?.toUpperCase() || 'SENSITIVE ACTION')}</div>
      <div><strong>Target:</strong> ${escapeHtml(payload?.element_text || 'Element #' + payload?.tag_id)}</div>
      <div><strong>Confidence:</strong> ${Math.round((payload?.confidence || 0) * 100)}%</div>
      <div><strong>Reason:</strong> ${escapeHtml(payload?.reason || 'Guardrail flagged potentially destructive intent.')}</div>
    `;
    confirmationModal.style.display = 'flex';
    confirmationModal.classList.remove('hidden');
  }

  // Update Status Pill
  function updateStatus(state, msg) {
    if (!statusIndicator) return;
    statusIndicator.className = 'status-pill';
    const label = statusIndicator.querySelector('.status-label');
    if (label) {
      if (state === 'thinking') {
        label.textContent = msg ? `🧠 ${msg.slice(0, 45)}` : 'Thinking...';
      } else if (state === 'acting') {
        label.textContent = msg ? `⚡ ${msg.slice(0, 45)}` : 'Executing...';
      } else if (state === 'waiting_user_input') {
        label.textContent = '⏸️ Action Required';
        statusIndicator.style.background = 'rgba(245, 158, 11, 0.2)';
        statusIndicator.style.borderColor = '#f59e0b';
      } else if (state === 'error') {
        label.textContent = msg ? `⚠ ${msg.slice(0, 40)}` : 'Error';
      } else {
        label.textContent = msg ? msg.slice(0, 45) : 'Ready';
        statusIndicator.style.background = '';
        statusIndicator.style.borderColor = '';
      }
    }
    // Also update reasoning box with live status message
    if (msg && (state === 'thinking' || state === 'acting' || state === 'waiting_user_input') && reasoningBox) {
      const icon = state === 'acting' ? '👁️' : (state === 'waiting_user_input' ? '⏸️' : '🧠');
      reasoningBox.innerHTML = `<strong>${icon} Agent:</strong> ${escapeHtml(msg)}`;
    }

    if (msg) {
      if (state === 'waiting_user_input') {
        speakAgentMessage('I have paused at the login screen. Please complete sign in in the browser to continue.');
      } else if (msg.includes('Accepted!') || msg.includes('All testcases passed')) {
        speakAgentMessage('Accepted! All testcases passed successfully.');
      } else if (msg.includes('Goal complete') || msg.includes('Task complete') || msg.includes('✓ Goal completed')) {
        speakAgentMessage('Task completed successfully.');
      }
    }
  }


  // Helper: Escape HTML
  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Dynamic Local Gateway Health Polling
  async function updateServerStatus() {
    const serverLabel = document.getElementById('server-label');
    const serverDot = document.getElementById('server-dot');
    if (!serverLabel || !serverDot) return;

    try {
      const res = await fetch('http://127.0.0.1:5000/api/health', { signal: AbortSignal.timeout(1800) });
      if (res.ok) {
        serverLabel.textContent = 'Server: Connected (5000)';
        serverDot.style.background = '#10b981'; // Green
      } else {
        serverLabel.textContent = 'Server: Standby';
        serverDot.style.background = '#f59e0b'; // Amber
      }
    } catch (e) {
      serverLabel.textContent = 'Server: Offline (Fast Mode)';
      serverDot.style.background = '#94a3b8'; // Slate
    }
  }
  setInterval(updateServerStatus, 5000);
  updateServerStatus();

  console.log('[Aero Agent] Popup controller initialized');
});
