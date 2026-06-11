// Runs in the page's MAIN world. Reads battle state from the Showdown client,
// emits compact state snapshots, and executes decisions sent back by the
// background service worker (via content-bridge.js).
(() => {
  if (window.__sdxLoaded) return;
  window.__sdxLoaded = true;

  const log = (...a) => console.log('[SDX]', ...a);
  const tracked = {}; // roomId -> { key, asks, answered, endedNotified }

  const getRooms = () => {
    if (window.app && window.app.rooms) return window.app.rooms; // classic Backbone client
    if (window.PS && window.PS.rooms) return window.PS.rooms; // preact client
    return null;
  };

  const isBattleRoom = (room) => room && room.id && room.id.startsWith('battle-') && (room.battle || room.request);

  const pct = (cond) => {
    if (!cond) return '?';
    if (cond.startsWith('0')) return '0% fnt';
    const m = cond.match(/^(\d+)\/(\d+)\s*(.*)$/);
    if (!m) return cond;
    const p = Math.round((100 * +m[1]) / +m[2]);
    return p + '%' + (m[3] ? ' ' + m[3] : '');
  };

  const species = (details) => (details || '').split(',')[0];

  const boostStr = (b) => {
    if (!b) return '';
    const parts = Object.entries(b)
      .filter(([, v]) => v)
      .map(([k, v]) => (v > 0 ? '+' + v : v) + k);
    return parts.length ? ' [' + parts.join(',') + ']' : '';
  };

  const sideMon = (p) =>
    species(p.speciesForme || p.details) +
    ' ' +
    (p.maxhp ? Math.round((100 * p.hp) / p.maxhp) + '%' : '?') +
    (p.status ? ' ' + p.status : '');

  // Build compact state text + legal action list from a battle room.
  const buildState = (room) => {
    const req = room.request;
    if (!req || req.wait) return null;
    const battle = room.battle || {};
    const lines = [];
    const legal = [];
    const mons = (req.side && req.side.pokemon) || [];

    if (req.teamPreview) {
      lines.push('TEAM PREVIEW. Your team: ' + mons.map((p, i) => `${i + 1} ${species(p.details)}`).join(', '));
      const foeSide = battle.farSide || {};
      const foeMons = (foeSide.pokemon || []).map((p) => species(p.speciesForme)).join(', ');
      if (foeMons) lines.push('Foe team: ' + foeMons);
      lines.push('Pick your lead.');
      for (let i = 1; i <= mons.length; i++) legal.push('team ' + i);
      return { text: lines.join('\n'), legal };
    }

    lines.push(`Turn ${battle.turn ?? '?'}`);

    const mySide = battle.mySide || {};
    const farSide = battle.farSide || {};
    const myActiveEngine = (mySide.active && mySide.active[0]) || null;
    const foeActive = (farSide.active && farSide.active[0]) || null;

    const activeIdx = mons.findIndex((p) => p.active);
    const me = activeIdx >= 0 ? mons[activeIdx] : null;
    if (me) {
      let s = `YOU: ${species(me.details)} ${pct(me.condition)}`;
      if (myActiveEngine) s += boostStr(myActiveEngine.boosts);
      if (me.item) s += ' item:' + me.item;
      if (me.ability || me.baseAbility) s += ' abil:' + (me.ability || me.baseAbility);
      lines.push(s);
    }

    const forced = Array.isArray(req.forceSwitch) && req.forceSwitch[0];
    const act = !forced && req.active && req.active[0];

    if (act && act.moves) {
      lines.push(
        'MOVES: ' +
          act.moves
            .map((mv, i) => `${i + 1} ${mv.move} ${mv.pp ?? '?'}pp${mv.disabled ? ' (disabled)' : ''}`)
            .join(', ')
      );
      act.moves.forEach((mv, i) => {
        if (!mv.disabled) legal.push('move ' + (i + 1));
      });
      if (legal.length === 0 && act.moves.length) legal.push('move 1'); // struggle etc.
      if (act.canMegaEvo) act.moves.forEach((mv, i) => !mv.disabled && legal.push(`move ${i + 1} mega`));
      if (act.canDynamax) act.moves.forEach((mv, i) => !mv.disabled && legal.push(`move ${i + 1} dynamax`));
      if (act.canTerastallize) {
        lines.push('Can terastallize to: ' + act.canTerastallize);
        act.moves.forEach((mv, i) => !mv.disabled && legal.push(`move ${i + 1} terastallize`));
      }
      if (act.canMegaEvo) lines.push('Can mega evolve.');
      if (act.canDynamax) lines.push('Can dynamax.');
    }

    const bench = mons
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !p.active);
    if (bench.length) {
      lines.push('BENCH: ' + bench.map(({ p, i }) => `${i + 1} ${species(p.details)} ${pct(p.condition)}`).join(', '));
    }
    const trapped = act && (act.trapped || act.maybeTrapped);
    if (forced || !act || !trapped) {
      bench.forEach(({ p, i }) => {
        if (!/^0\b|fnt/.test(p.condition || '')) legal.push('switch ' + (i + 1));
      });
    }
    if (trapped) lines.push('You are trapped (cannot switch).');

    if (forced) lines.push('Your pokemon fainted/must switch. Choose a switch.');

    if (foeActive) {
      let s = `FOE: ${sideMon(foeActive)}` + boostStr(foeActive.boosts);
      const vols = foeActive.volatiles ? Object.keys(foeActive.volatiles).join(',') : '';
      if (vols) s += ' (' + vols + ')';
      lines.push(s);
    }
    const foeBench = (farSide.pokemon || []).filter((p) => p !== foeActive);
    if (foeBench.length) lines.push('FOE BENCH (revealed): ' + foeBench.map(sideMon).join(', '));

    const field = [];
    if (battle.weather) field.push('weather:' + battle.weather);
    if (battle.pseudoWeather && battle.pseudoWeather.length)
      field.push('field:' + battle.pseudoWeather.map((pw) => pw[0]).join(','));
    const sc = (side) => Object.keys(side.sideConditions || {}).join(',');
    if (mySide.sideConditions && sc(mySide)) field.push('my-hazards:' + sc(mySide));
    if (farSide.sideConditions && sc(farSide)) field.push('foe-hazards:' + sc(farSide));
    if (field.length) lines.push('FIELD: ' + field.join(' | '));

    if (!legal.length) return null;
    return { text: lines.join('\n'), legal };
  };

  const emit = (detail) => window.dispatchEvent(new CustomEvent('sdx_state', { detail }));

  const tick = () => {
    const rooms = getRooms();
    if (!rooms) return;
    for (const id of Object.keys(rooms)) {
      const room = rooms[id];
      if (!isBattleRoom(room)) continue;
      const t = (tracked[id] = tracked[id] || { key: null, asks: 0, endedNotified: false });

      if (room.battle && room.battle.ended) {
        if (!t.endedNotified) {
          t.endedNotified = true;
          let winner = '';
          if (room.winner && typeof room.winner === 'string') {
            winner = room.winner;
          } else if (room.battle && typeof room.battle.winner === 'string') {
            winner = room.battle.winner;
          }
          const myName = (room.battle.mySide && room.battle.mySide.name) || '';
          emit({ kind: 'end', roomId: id, won: winner && myName ? winner === myName : null });
          log('battle ended in', id, 'winner:', winner || '(unknown)');
        }
        continue;
      }

      const req = room.request;
      if (!req || req.wait || !req.rqid) continue;
      const key = req.rqid + (Array.isArray(req.forceSwitch) && req.forceSwitch[0] ? ':fs' : '');
      if (t.key === key && (t.asks >= 3 || Date.now() - t.lastAsk < 25000)) continue;

      const state = buildState(room);
      if (!state) continue;
      t.asks = t.key === key ? (t.asks || 0) + 1 : 1;
      t.key = key;
      t.lastAsk = Date.now();
      const format = (room.battle && room.battle.tier) || id.replace(/^battle-/, '').replace(/-\d+.*$/, '');
      emit({ kind: 'decide', roomId: id, rqid: req.rqid, format, ...state });
      log('asking for decision', id, 'rqid', req.rqid, '\n' + state.text, '\nlegal:', state.legal.join(' | '));
    }
  };

  // Execute decisions coming back from the background worker.
  window.addEventListener('sdx_act', (e) => {
    const { roomId, rqid, action, chat, why } = e.detail || {};
    const rooms = getRooms();
    const room = rooms && rooms[roomId];
    if (!room || typeof room.send !== 'function') return log('cannot act: room missing', roomId);
    if (action) {
      room.send(`/choose ${action}|${rqid}`);
      log('chose:', action, why ? '— thinking: ' + why : '', 'in', roomId);
    }
    if (chat) {
      const clean = String(chat).replace(/[\r\n|]/g, ' ').replace(/^[\/!]+/, '').slice(0, 150).trim();
      if (clean) {
        room.send(clean);
        log('chat:', clean);
      }
    }
  });

  setInterval(tick, 1000);
  log('content-main loaded; client:', window.app ? 'classic' : window.PS ? 'preact' : 'unknown');
})();
