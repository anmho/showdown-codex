const $ = (id) => document.getElementById(id);

const pretty = (raw) => {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
};

function block(parent, label, text) {
  const lab = document.createElement('div');
  lab.className = 'label';
  lab.textContent = label;
  const pre = document.createElement('pre');
  pre.textContent = text;
  parent.appendChild(lab);
  parent.appendChild(pre);
}

function render(s) {
  $('dot').className = 'dot ' + (s.connected ? 'ok' : 'bad');
  $('conn').textContent = s.connected ? 'codex app-server connected' : 'not connected';
  $('model').textContent = s.cfg.model.replace('gpt-', '') + ' / ' + s.cfg.effort;
  $('enabled').checked = !!s.cfg.enabled;
  $('chat').checked = !!s.cfg.chat;
  $('decisions').textContent = s.usage.decisions;
  
  const total = (s.wins || 0) + (s.losses || 0);
  const rate = total > 0 ? Math.round((100 * (s.wins || 0)) / total) : 0;
  $('winrate').textContent = `${rate}% (${s.wins || 0}W / ${s.losses || 0}L)`;

  $('tokens').textContent = `${s.usage.input} / ${s.usage.cachedInput} / ${s.usage.output}`;
  $('status').textContent = s.status === 'connected' || s.status === 'idle' ? '' : s.status;

  const logDiv = $('log');
  const existingEntries = new Map();
  for (const child of logDiv.children) {
    if (child.dataset.t) {
      existingEntries.set(child.dataset.t, child);
    }
  }

  const activeTimestamps = new Set();

  for (let i = 0; i < s.lastActions.length; i++) {
    const a = s.lastActions[i];
    const tStr = String(a.t);
    activeTimestamps.add(tStr);

    let entry = existingEntries.get(tStr);

    if (!entry) {
      entry = document.createElement('div');
      entry.className = 'entry';
      // Animate if added in the last 6 seconds
      if (Date.now() - a.t < 6000) {
        entry.classList.add('new-entry');
      }
      entry.dataset.t = tStr;

      const action = document.createElement('div');
      action.className = 'action';
      action.textContent = a.action + (a.chat ? `  ·  "${a.chat}"` : '');
      entry.appendChild(action);

      if (a.why) {
        const why = document.createElement('div');
        why.className = 'why';
        why.textContent = a.why;
        entry.appendChild(why);
      }

      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = 'raw';
      det.appendChild(sum);
      if (a.thinking) block(det, 'reasoning', a.thinking);
      if (a.raw) block(det, 'model output', pretty(a.raw));
      if (a.state) block(det, 'prompt state', a.state);
      entry.appendChild(det);
    }

    if (logDiv.children[i] !== entry) {
      logDiv.insertBefore(entry, logDiv.children[i]);
    }
  }

  for (const child of Array.from(logDiv.children)) {
    if (child.dataset.t && !activeTimestamps.has(child.dataset.t)) {
      logDiv.removeChild(child);
    }
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'status' }, (s) => {
    if (s) {
      chrome.storage.local.get({ wins: 0, losses: 0 }).then((store) => {
        s.wins = store.wins;
        s.losses = store.losses;
        render(s);
      });
    }
  });
}

$('enabled').addEventListener('change', (e) => chrome.storage.local.set({ enabled: e.target.checked }));
$('chat').addEventListener('change', (e) => chrome.storage.local.set({ chat: e.target.checked }));
$('reset-stats').addEventListener('click', (e) => {
  e.preventDefault();
  if (confirm('Are you sure you want to reset winrate stats?')) {
    chrome.storage.local.set({ wins: 0, losses: 0, history: [] }, () => refresh());
  }
});

refresh();
setInterval(refresh, 1500);
