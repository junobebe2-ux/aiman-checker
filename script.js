/* AIMAN CHECKER — Frontend */

(() => {
  'use strict';

  const urlInput = document.getElementById('urlInput');
  const urlCount = document.getElementById('urlCount');
  const checkBtn = document.getElementById('checkBtn');
  const errorMsg = document.getElementById('errorMsg');
  const progressCard = document.getElementById('progressCard');
  const progressBar = document.getElementById('progressBar');
  const progressStatus = document.getElementById('progressStatus');
  const progressDetail = document.getElementById('progressDetail');
  const resultsCard = document.getElementById('resultsCard');
  const resultsBody = document.getElementById('resultsBody');
  const resultsSummary = document.getElementById('resultsSummary');
  const statsRow = document.getElementById('statsRow');
  const errorsCard = document.getElementById('errorsCard');
  const errorsList = document.getElementById('errorsList');
  const sampleBtn = document.getElementById('sampleBtn');
  const clearBtn = document.getElementById('clearBtn');
  const copyBtn = document.getElementById('copyBtn');
  const csvBtn = document.getElementById('csvBtn');
  const jsonBtn = document.getElementById('jsonBtn');
  const fileInput = document.getElementById('fileInput');
  const browseBtn = document.getElementById('browseBtn');
  const uploadZone = document.getElementById('uploadZone');
  const fileName = document.getElementById('fileName');

  let results = [];
  let sortAsc = {};
  let lastSortKey = null;

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  // Sample
  sampleBtn.addEventListener('click', () => {
    urlInput.value = [
      'https://github.com',
      'https://google.com',
      'https://stackoverflow.com',
      'https://wikipedia.org',
      'https://youtube.com',
      'https://reddit.com',
      'https://linkedin.com'
    ].join('\n');
    updateCount();
  });

  clearBtn.addEventListener('click', () => { urlInput.value = ''; updateCount(); });

  // File upload
  browseBtn.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
  uploadZone.addEventListener('drop', e => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFile(fileInput.files[0]);
  });

  function handleFile(file) {
    if (!file.name.endsWith('.txt')) {
      showError('Only .txt files supported');
      return;
    }
    fileName.textContent = file.name + ' (' + (file.size / 1024).toFixed(1) + ' KB)';
    fileName.hidden = false;
    const reader = new FileReader();
    reader.onload = e => {
      urlInput.value = e.target.result;
      updateCount();
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelector('[data-tab="paste"]').classList.add('active');
      document.getElementById('tab-paste').classList.add('active');
    };
    reader.readAsText(file);
  }

  urlInput.addEventListener('input', updateCount);
  function updateCount() {
    const urls = getURLs();
    urlCount.textContent = urls.length;
    urlCount.style.color = urls.length > 500 ? '#e74c3c' : 'inherit';
  }

  function getURLs() {
    return urlInput.value.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  }

  checkBtn.addEventListener('click', checkDomains);

  function showError(msg) { errorMsg.textContent = msg; errorMsg.hidden = false; }
  function hideError() { errorMsg.hidden = true; }

  async function checkDomains() {
    hideError();
    let urls = getURLs();
    if (urls.length === 0) { showError('Enter at least one domain'); return; }
    if (urls.length > 500) { showError('Maximum 500 domains per session'); return; }

    checkBtn.disabled = true;
    checkBtn.querySelector('.btn-text').textContent = 'Checking';
    checkBtn.querySelector('.btn-icon').innerHTML = '<span class="spinner"></span>';
    progressCard.hidden = false;
    resultsCard.hidden = true;
    errorsCard.hidden = true;
    statsRow.hidden = true;

    const total = urls.length;
    progressBar.style.width = '0%';
    progressStatus.textContent = '0 / ' + total;
    progressDetail.textContent = 'Sending request...';

    try {
      progressDetail.textContent = 'Requesting server...';
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error('Server ' + res.status + ': ' + text);
      }
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Unknown error');

      results = data.results || [];
      progressBar.style.width = '100%';
      progressStatus.textContent = (data.checked || 0) + ' / ' + total;
      progressDetail.textContent = 'Done';

      if (data.errors && data.errors.length > 0) {
        errorsCard.hidden = false;
        errorsList.innerHTML = data.errors.map(e => '<li>' + esc(e) + '</li>').join('');
      }

      await sleep(300);
      renderResults(results);
    } catch (err) {
      showError(err.message);
      progressCard.hidden = true;
    } finally {
      checkBtn.disabled = false;
      checkBtn.querySelector('.btn-text').textContent = 'Check Authority';
      checkBtn.querySelector('.btn-icon').innerHTML = '◆';
    }
  }

  function renderResults(data) {
    results = data;
    resultsCard.hidden = false;
    resultsSummary.textContent = data.length + ' domain' + (data.length !== 1 ? 's' : '');
    resultsBody.innerHTML = '';

    if (data.length === 0) {
      resultsBody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:32px;color:#4a3f32">No results</td></tr>';
      return;
    }

    data.forEach(r => {
      const da = parseFloat(r.DA) || 0;
      const daClass = da >= 50 ? 'da-high' : da >= 30 ? 'da-mid' : 'da-low';
      const spam = parseFloat(r.Spam) || 0;
      const spamClass = spam > 10 ? 'ss-high' : 'ss-low';

      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td class="domain-cell">' + esc(r.domain) + '</td>' +
        '<td class="da-cell ' + daClass + '">' + da + '</td>' +
        '<td>' + (parseFloat(r.PA) || 0) + '</td>' +
        '<td><span class="ss-badge ' + spamClass + '">' + spam + '</span></td>' +
        '<td>' + (parseFloat(r.DR) || 0) + '</td>' +
        '<td>' + (parseFloat(r.TF) || 0) + '</td>' +
        '<td>' + (parseFloat(r.CF) || 0) + '</td>' +
        '<td>' + fmt(r.Backlinks) + '</td>' +
        '<td>' + fmt(r.Traffic) + '</td>';
      resultsBody.appendChild(tr);
    });

    // Stats
    const das = data.map(r => parseFloat(r.DA) || 0).filter(d => d > 0);
    const pas = data.map(r => parseFloat(r.PA) || 0).filter(p => p > 0);
    const spams = data.map(r => parseFloat(r.Spam) || 0);

    if (das.length > 0) {
      statsRow.hidden = false;
      document.getElementById('statHighDA').textContent = das.filter(d => d >= 50).length;
      document.getElementById('statAvgDA').textContent = (das.reduce((a,b) => a+b, 0) / das.length).toFixed(1);
      document.getElementById('statAvgPA').textContent = pas.length > 0 ? (pas.reduce((a,b) => a+b, 0) / pas.length).toFixed(1) : '0';
      document.getElementById('statAvgSpam').textContent = (spams.reduce((a,b) => a+b, 0) / spams.length).toFixed(1);
    }

    if (lastSortKey) sortTable(lastSortKey, sortAsc[lastSortKey]);
  }

  // Sorting
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      const asc = sortAsc[key] !== undefined ? !sortAsc[key] : true;
      sortAsc[key] = asc;
      lastSortKey = key;
      document.querySelectorAll('th[data-sort]').forEach(t => { t.classList.remove('sort-asc', 'sort-desc'); t.style.color = ''; });
      th.classList.add(asc ? 'sort-asc' : 'sort-desc');
      th.style.color = '#D4AF37';
      sortTable(key, asc);
    });
  });

  function sortTable(key, asc) {
    const tbody = resultsBody;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length === 0) return;
    rows.sort((a, b) => {
      const va = cellVal(a, key);
      const vb = cellVal(b, key);
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return asc ? cmp : -cmp;
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  function cellVal(tr, key) {
    const cells = tr.querySelectorAll('td');
    const idx = ['domain','DA','PA','Spam','DR','TF','CF','Backlinks','Traffic'].indexOf(key);
    if (idx === -1 || !cells[idx]) return '';
    const val = cells[idx].textContent.trim().replace(/,/g, '');
    return key === 'domain' ? val.toLowerCase() : parseFloat(val) || 0;
  }

  // Export
  copyBtn.addEventListener('click', () => {
    const header = 'Domain\tDA\tPA\tSpam\tDR\tTF\tCF\tBacklinks\tTraffic';
    const text = results.map(r =>
      r.domain + '\t' + r.DA + '\t' + r.PA + '\t' + r.Spam + '\t' + r.DR + '\t' + r.TF + '\t' + r.CF + '\t' + fmtNum(r.Backlinks) + '\t' + fmtNum(r.Traffic)
    ).join('\n');
    navigator.clipboard.writeText(header + '\n' + text).then(() => {
      copyBtn.textContent = 'Done';
      setTimeout(() => copyBtn.textContent = 'Copy', 2000);
    });
  });

  csvBtn.addEventListener('click', () => {
    const header = 'Domain,DA,PA,Spam,DR,TF,CF,Backlinks,Traffic,Keywords';
    const rows = results.map(r => '"' + r.domain + '",' + r.DA + ',' + r.PA + ',' + r.Spam + ',' + r.DR + ',' + r.TF + ',' + r.CF + ',' + r.Backlinks + ',' + r.Traffic + ',' + (r.Keywords || 0));
    download(header + '\n' + rows.join('\n'), 'aiman-checker.csv', 'text/csv');
  });

  jsonBtn.addEventListener('click', () => {
    download(JSON.stringify(results, null, 2), 'aiman-checker.json', 'application/json');
  });

  // Helpers
  function fmt(n) {
    const v = parseInt(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(1) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
    return v.toLocaleString();
  }
  function fmtNum(n) {
    return (parseInt(n) || 0).toLocaleString();
  }
  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }
  function download(content, name, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  updateCount();
})();