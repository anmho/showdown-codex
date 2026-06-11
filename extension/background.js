// Service worker: JSON-RPC client to `codex app-server --listen ws://...`.
// One ephemeral thread per battle; each turn sends a compact state and gets a
// schema-constrained JSON action back.

const DEFAULTS = {
  enabled: true,
  wsUrl: 'ws://127.0.0.1:8124',
  model: 'gpt-5.3-codex-spark',
  effort: 'low',
  chat: true,
};

const SYSPROMPT =
  'You are an expert competitive Pokemon player battling on Pokemon Showdown. ' +
  'Each user message is the current battle state plus the list of legal actions. ' +
  'Pick the strongest action: recall the exact types, base stats, and abilities of all bench and active Pokemon. Weigh type matchups, bulk, speed, boosts, hazards, and STAB. ' +
  'When switching, calculate the damage the incoming Pokemon will take from the opponent\'s boosted STAB moves and ensure it can safely survive and retaliate. ' +
  'Never use tools. Reply ONLY with the requested JSON. ' +
  "The 'why' field is your reasoning for the pick in 25 words or less. " +
  "The 'chat' field is a short message to the opponent: '' almost always, 'glhf' on turn 1, brief banter only on huge plays.";

let cfg = { ...DEFAULTS };
let ws = null;
let wsReady = null; // promise while connecting/initializing
let rpcId = 0;
const pending = new Map(); // rpc id -> {resolve, reject}
const threads = new Map(); // roomId -> threadId
const lastMsg = new Map(); // threadId -> last agentMessage text
const thinking = new Map(); // threadId -> accumulated reasoning summary text
const turnWaiters = new Map(); // threadId -> {resolve, reject, timer}
const answered = new Map(); // roomId:rqid -> decision (replay cache)
const usage = { input: 0, cachedInput: 0, output: 0, decisions: 0 };
let lastActions = [];
let status = 'idle';

chrome.storage.local.get(DEFAULTS).then((v) => Object.assign(cfg, v));
chrome.storage.onChanged.addListener((ch) => {
  for (const k of Object.keys(ch)) if (k in cfg) cfg[k] = ch[k].newValue;
});

const setBadge = (text, color) => {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
};

function rpc(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++rpcId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
}

function notify(method, params) {
  ws.send(JSON.stringify({ jsonrpc: '2.0', method, params }));
}

function handleNotification(msg) {
  const p = msg.params || {};
  switch (msg.method) {
    case 'item/completed': {
      const item = p.item || {};
      if (item.type === 'agentMessage' && p.threadId) lastMsg.set(p.threadId, item.text || '');
      break;
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      if (p.threadId) thinking.set(p.threadId, (thinking.get(p.threadId) || '') + (p.delta || ''));
      break;
    }
    case 'turn/completed': {
      const tid = p.threadId;
      const w = tid && turnWaiters.get(tid);
      if (w) {
        turnWaiters.delete(tid);
        clearTimeout(w.timer);
        w.resolve(lastMsg.get(tid) || '');
      }
      break;
    }
    case 'thread/tokenUsage/updated': {
      const u = p.tokenUsage && p.tokenUsage.last;
      if (u) {
        usage.input += u.inputTokens || 0;
        usage.cachedInput += u.cachedInputTokens || 0;
        usage.output += (u.outputTokens || 0) + (u.reasoningOutputTokens || 0);
      }
      break;
    }
    case 'error': {
      const tid = p.threadId;
      const w = tid && turnWaiters.get(tid);
      const message = (p.error && p.error.message) || 'app-server error';
      if (w) {
        turnWaiters.delete(tid);
        clearTimeout(w.timer);
        w.reject(new Error(message));
      }
      console.warn('[SDX] app-server error:', message.slice(0, 300));
      break;
    }
  }
}

function ensureWs() {
  if (ws && ws.readyState === WebSocket.OPEN && !wsReady) return Promise.resolve();
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    const sock = new WebSocket(cfg.wsUrl);
    const fail = (err) => {
      wsReady = null;
      status = 'disconnected';
      setBadge('off', '#999');
      reject(err instanceof Error ? err : new Error('codex app-server unreachable at ' + cfg.wsUrl));
    };
    sock.onerror = fail;
    sock.onclose = () => {
      if (ws === sock) {
        ws = null;
        status = 'disconnected';
        for (const [, p] of pending) p.reject(new Error('ws closed'));
        pending.clear();
        for (const [tid, w] of turnWaiters) {
          clearTimeout(w.timer);
          w.reject(new Error('ws closed'));
          turnWaiters.delete(tid);
        }
      }
    };
    sock.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.id != null && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message || 'rpc error'));
        else p.resolve(m.result);
      } else if (m.method) {
        handleNotification(m);
      }
    };
    sock.onopen = async () => {
      ws = sock;
      try {
        await rpc('initialize', {
          clientInfo: { name: 'showdown-codex', title: 'Showdown Codex Autopilot', version: '0.1.0' },
        });
        notify('initialized', {});
        wsReady = null;
        status = 'connected';
        setBadge('', '#4a4');
        resolve();
      } catch (err) {
        fail(err);
      }
    };
  });
  return wsReady;
}

async function getThread(roomId, format) {
  let tid = threads.get(roomId);
  if (tid) return tid;
  const res = await rpc('thread/start', {
    ephemeral: true,
    model: cfg.model,
    approvalPolicy: 'never',
    sandbox: 'read-only',
    baseInstructions: SYSPROMPT + (format ? ` Format: ${format}.` : ''),
  });
  tid = res.thread.id;
  threads.set(roomId, tid);
  return tid;
}

function waitForTurn(threadId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      turnWaiters.delete(threadId);
      reject(new Error('decision timeout'));
    }, timeoutMs);
    turnWaiters.set(threadId, { resolve, reject, timer });
  });
}

function parseDecision(text, legal) {
  let action = null;
  let chat = '';
  let why = '';
  try {
    const j = JSON.parse(text.replace(/^```\w*\n?|```$/g, '').trim());
    action = j.action;
    chat = typeof j.chat === 'string' ? j.chat : '';
    why = typeof j.why === 'string' ? j.why : '';
  } catch {
    const hit = legal.find((l) => text.includes(l));
    if (hit) action = hit;
  }
  if (!legal.includes(action)) action = legal[0];
  return { action, chat, why };
}

async function decide(detail) {
  const { roomId, rqid, format, text, legal } = detail;
  const key = roomId + ':' + rqid;
  if (answered.has(key)) return answered.get(key); // replay for lost/duplicate asks

  status = 'thinking';
  setBadge('...', '#36c');
  await ensureWs();
  const threadId = await getThread(roomId, format);
  lastMsg.delete(threadId);
  thinking.delete(threadId);

  const wait = waitForTurn(threadId, 45000);
  await rpc('turn/start', {
    threadId,
    model: cfg.model,
    effort: cfg.effort,
    summary: 'auto',
    input: [{ type: 'text', text }],
    outputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: legal },
        why: { type: 'string' },
        chat: { type: 'string' },
      },
      required: ['action', 'why', 'chat'],
      additionalProperties: false,
    },
  });
  const reply = await wait;
  const decision = parseDecision(reply, legal);
  if (!cfg.chat) decision.chat = '';
  usage.decisions++;
  answered.set(key, decision);
  if (answered.size > 50) answered.delete(answered.keys().next().value);
  lastActions.unshift({
    t: Date.now(),
    roomId,
    action: decision.action,
    chat: decision.chat,
    why: decision.why,
    raw: reply,
    thinking: thinking.get(threadId) || '',
    state: text,
  });
  lastActions = lastActions.slice(0, 8);
  status = 'connected';
  setBadge('', '#4a4');
  return decision;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sdx') return;
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'state' || !cfg.enabled) return;
    const d = msg.detail || {};
    try {
      if (d.kind === 'end') {
        const tid = threads.get(d.roomId);
        threads.delete(d.roomId);
        if (tid) rpc('thread/archive', { threadId: tid }).catch(() => {});
        
        // Record win/loss statistics
        if (d.won !== null && d.won !== undefined) {
          chrome.storage.local.get({ wins: 0, losses: 0, history: [] }).then((store) => {
            if (d.won) {
              store.wins++;
            } else {
              store.losses++;
            }
            store.history.unshift({
              roomId: d.roomId,
              format: d.format || '',
              won: d.won,
              t: Date.now()
            });
            store.history = store.history.slice(0, 50); // Keep last 50 battles
            chrome.storage.local.set(store);
          });
        }

        if (cfg.chat) port.postMessage({ type: 'act', detail: { roomId: d.roomId, chat: 'gg' } });
        return;
      }
      if (d.kind !== 'decide' || !d.legal || !d.legal.length) return;
      const decision = await decide(d);
      port.postMessage({
        type: 'act',
        detail: { roomId: d.roomId, rqid: d.rqid, action: decision.action, chat: decision.chat, why: decision.why },
      });
    } catch (err) {
      console.warn('[SDX] decide failed:', err.message);
      status = 'error: ' + err.message;
      setBadge('err', '#c33');
      // Fall back to the first legal action so the battle timer never runs out.
      if (d.kind === 'decide' && d.legal && d.legal.length) {
        try {
          port.postMessage({
            type: 'act',
            detail: { roomId: d.roomId, rqid: d.rqid, action: d.legal[0], chat: '' },
          });
        } catch {}
      }
    }
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'status') {
    // Connect eagerly when the popup asks, so it reflects real reachability
    // (the worker otherwise only dials the server when a decision is needed).
    ensureWs()
      .catch(() => {})
      .finally(() =>
        sendResponse({
          status,
          cfg,
          usage,
          lastActions,
          battles: threads.size,
          connected: !!(ws && ws.readyState === WebSocket.OPEN),
        })
      );
    return true;
  }
  return false;
});
