const fs = require('fs');
const path = require('path');

const WS_URL = 'ws://127.0.0.1:8123';
const MODEL = 'gpt-5.3-codex-spark';
const EFFORT = 'medium';

const SYSPROMPT =
  'You are an expert competitive Pokemon player battling on Pokemon Showdown. ' +
  'Each user message is the current battle state plus the list of legal actions. ' +
  'Pick the strongest action: recall the exact types, base stats, and abilities of all bench and active Pokemon. Weigh type matchups, bulk, speed, boosts, hazards, and STAB. ' +
  'When switching, calculate the damage the incoming Pokemon will take from the opponent\'s boosted STAB moves and ensure it can safely survive and retaliate. ' +
  'Never use tools. Reply ONLY with the requested JSON. ' +
  "The 'why' field is your reasoning for the pick in 25 words or less. " +
  "The 'chat' field is a short message to the opponent: '' almost always, 'glhf' on turn 1, brief banter only on huge plays.";

async function run() {
  const evalsPath = path.join(__dirname, 'evals.json');
  if (!fs.existsSync(evalsPath)) {
    console.error('evals.json not found!');
    process.exit(1);
  }
  const testCases = JSON.parse(fs.readFileSync(evalsPath, 'utf8'));

  console.log(`Loaded ${testCases.length} evaluation test cases.`);
  console.log(`Connecting to Codex app-server at ${WS_URL}...`);

  const ws = new WebSocket(WS_URL);

  let rpcId = 0;
  const pending = new Map();
  const turnWaiters = new Map();
  const lastMsg = new Map();

  ws.onmessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }

    if (m.id != null && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error.message || 'RPC error'));
      else p.resolve(m.result);
    } else if (m.method) {
      const p = m.params || {};
      switch (m.method) {
        case 'item/completed': {
          const item = p.item || {};
          if (item.type === 'agentMessage' && p.threadId) {
            lastMsg.set(p.threadId, item.text || '');
          }
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
        case 'error': {
          const tid = p.threadId;
          const w = tid && turnWaiters.get(tid);
          const message = (p.error && p.error.message) || 'app-server error';
          if (w) {
            turnWaiters.delete(tid);
            clearTimeout(w.timer);
            w.reject(new Error(message));
          }
          break;
        }
      }
    }
  };

  const rpc = (method, params) => {
    return new Promise((resolve, reject) => {
      const id = ++rpcId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  console.log('Connected. Initializing handshake...');
  await rpc('initialize', {
    clientInfo: { name: 'showdown-evals', title: 'Showdown Codex Evals', version: '0.1.0' },
  });
  console.log('Handshake ok.\n');

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    console.log(`[Eval ${i + 1}/${testCases.length}]: ${tc.name}`);
    
    try {
      // 1. Start thread
      const startRes = await rpc('thread/start', {
        ephemeral: true,
        model: MODEL,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        baseInstructions: SYSPROMPT + (tc.format ? ` Format: ${tc.format}.` : ''),
      });
      const threadId = startRes.thread.id;

      // 2. Start turn and wait
      const turnPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          turnWaiters.delete(threadId);
          reject(new Error('timeout'));
        }, 30000);
        turnWaiters.set(threadId, { resolve, reject, timer });
      });

      await rpc('turn/start', {
        threadId,
        model: MODEL,
        effort: EFFORT,
        summary: 'none',
        input: [{ type: 'text', text: tc.state }],
        outputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: tc.legal },
            why: { type: 'string' },
            chat: { type: 'string' },
          },
          required: ['action', 'why', 'chat'],
          additionalProperties: false,
        },
      });

      const rawReply = await turnPromise;
      let decision;
      try {
        decision = JSON.parse(rawReply.replace(/^```\w*\n?|```$/g, '').trim());
      } catch {
        // fallback regex parsing
        const hit = tc.legal.find((l) => rawReply.includes(l));
        decision = { action: hit || null, why: 'parse failed', chat: '' };
      }

      const action = decision.action;
      const why = decision.why || '';
      
      console.log(`  > Model Picked: ${action}`);
      console.log(`  > Reasoning   : "${why}"`);

      let casePassed = true;
      if (tc.expected && !tc.expected.includes(action)) {
        console.error(`  ❌ FAIL: Picked "${action}" which is not in the expected list [${tc.expected.join(', ')}]`);
        casePassed = false;
      }
      if (tc.unexpected && tc.unexpected.includes(action)) {
        console.error(`  ❌ FAIL: Picked "${action}" which is explicitly forbidden/unexpected!`);
        casePassed = false;
      }

      if (casePassed) {
        console.log('  ✅ PASS');
        passed++;
      } else {
        failed++;
      }

      // Archive thread
      await rpc('thread/archive', { threadId }).catch(() => {});

    } catch (err) {
      console.error(`  ❌ ERROR running test case:`, err.message);
      failed++;
    }
    console.log();
  }

  console.log('======================================');
  console.log(`Scorecard: ${passed} Passed, ${failed} Failed`);
  console.log('======================================');

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error running evals:', err);
  process.exit(1);
});
