/**
 * Aero Agent — Full Page Knowledge Briefing Viewer
 * Dedicated separate browser tab renderer for multi-page PDFs and documents
 */

(function () {
  'use strict';

  const titleEl = document.getElementById('report-title');
  const sourceEl = document.getElementById('report-source');
  const dateEl = document.getElementById('report-date');
  const bodyEl = document.getElementById('report-body');
  const typeBadgeEl = document.getElementById('doc-type-badge');
  const copyBtn = document.getElementById('copy-report-btn');
  const printBtn = document.getElementById('print-report-btn');
  const closeBtn = document.getElementById('close-tab-btn');

  let currentMarkdown = '';

  function renderMarkdown(md) {
    if (!md) return '<p style="color:#64748b;">No content available.</p>';

    // Parse Markdown tables
    let text = md.replace(/((?:\|[^\n]+\|\r?\n)+)/g, (match) => {
      const rows = match.trim().split(/\r?\n/).map(r => r.trim()).filter(Boolean);
      if (rows.length < 2) return match;

      let html = '<div class="table-wrapper"><table>';
      let hasHeader = false;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (/^\|[-:\s|]+\|$/.test(row)) {
          hasHeader = true;
          continue;
        }
        const cells = row.split('|').slice(1, -1).map(c => c.trim());
        if (i === 0 || (!hasHeader && i === 0)) {
          html += '<thead><tr>';
          cells.forEach(c => html += `<th>${c}</th>`);
          html += '</tr></thead><tbody>';
        } else {
          html += '<tr>';
          cells.forEach(c => html += `<td>${c}</td>`);
          html += '</tr>';
        }
      }
      if (hasHeader) html += '</tbody>';
      html += '</table></div>';
      return html;
    });

    return text
      .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
      .replace(/^### (.*$)/gim, '<h3>$1</h3>')
      .replace(/^## (.*$)/gim, '<h2>$1</h2>')
      .replace(/^# (.*$)/gim, '<h2>$1</h2>')
      .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/gim, '<em>$1</em>')
      .replace(/`([^`]+)`/gim, '<code>$1</code>')
      .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
      .replace(/^- (.*$)/gim, '<li>$1</li>')
      .replace(/^\d+\.\s+(.*$)/gim, '<li>$1</li>')
      .replace(/\n\n/gim, '<p></p>');
  }

  function loadSummaryData() {
    chrome.storage.local.get(['latestSummary'], (data) => {
      const summary = data?.latestSummary;
      if (!summary) {
        if (titleEl) titleEl.textContent = 'Knowledge Briefing Viewer';
        if (bodyEl) bodyEl.innerHTML = '<p style="color:#64748b;">No summary generated yet. Attach a PDF or ask the agent to summarize a webpage.</p>';
        return;
      }

      currentMarkdown = summary.markdown || '';
      const title = summary.title || 'Executive Knowledge Briefing';
      const source = summary.source || 'Uploaded Document';
      const timestamp = summary.timestamp ? new Date(summary.timestamp).toLocaleString() : new Date().toLocaleString();

      document.title = `${title} — Aero Agent Briefing`;
      if (titleEl) titleEl.textContent = title;
      if (sourceEl) sourceEl.textContent = `Source: ${source}`;
      if (dateEl) dateEl.textContent = `Generated: ${timestamp}`;

      const isPdf = title.toLowerCase().includes('.pdf') || source.toLowerCase().includes('.pdf');
      if (typeBadgeEl) {
        typeBadgeEl.textContent = isPdf ? '📑 PDF Document' : '🌐 Webpage Analysis';
      }

      if (bodyEl) {
        bodyEl.innerHTML = renderMarkdown(currentMarkdown);
      }
    });
  }

  // Action Buttons
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      if (!currentMarkdown) return;
      navigator.clipboard.writeText(currentMarkdown).then(() => {
        copyBtn.textContent = '✓ Copied!';
        setTimeout(() => { copyBtn.textContent = '📋 Copy Report'; }, 1800);
      });
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      window.print();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      window.close();
    });
  }

  // Auto-update if storage changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.latestSummary) {
      loadSummaryData();
    }
  });

  // Initial load
  loadSummaryData();
})();
