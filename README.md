# Showdown Codex Autopilot

Chrome extension (MV3) that plays [Pokemon Showdown](https://play.pokemonshowdown.com)
autonomously using local **codex app-server** inference
(`gpt-5.4-codex`, reasoning effort `low` or `medium`).

## How it works

```
play.pokemonshowdown.com page (Backbone client)
  └─ content-main.js   (MAIN world) reads room.request / room.battle,
     builds a compact state + legal-action list, executes /choose & chat
  └─ content-bridge.js (isolated) relays via a chrome.runtime Port
       └─ background.js  JSON-RPC over WebSocket → ws-origin-proxy → codex app-server
            (the proxy strips the Origin header: codex app-server 403s any
             handshake that carries one, and browsers always send it)
            thread/start (ephemeral, tiny baseInstructions) per battle
            turn/start per game turn with outputSchema:
              { action: enum[legal actions], chat: string }
```

Supported actions: attacks (`move N`), mega (`move N mega`), terastallize
(`move N terastallize`), dynamax, switches, team-preview lead picks, and chat.
Doubles is not supported (random battles are singles).

## Token efficiency

- `baseInstructions` replaces Codex's large default system prompt with ~90 words.
- One ephemeral thread per battle → turn history is server-side prompt-cached;
  each turn only adds ~100-250 tokens of state.
- `outputSchema` with the legal actions as an **enum** → no invalid moves, and
  the reply is a few tokens of JSON. `summary: "none"`, effort `low`.
- No screenshots/vision — pure text state extracted from the client's own data.

## Run

1. `./run-server.sh` (starts `codex app-server` on ws://127.0.0.1:8123 plus the
   origin-stripping proxy on ws://127.0.0.1:8124, which the extension dials;
   requires `codex login` to have been done).
2. Load `extension/` via `chrome://extensions` → Developer mode → Load unpacked.
3. Open play.pokemonshowdown.com, log in, start a battle (e.g. Random Battle).
   The autopilot picks every move; the popup shows status, recent actions, and
   token usage. Toggle it off from the popup at any time.

If a decision fails or times out (45 s), the extension falls back to the first
legal action so the battle timer never runs out.

Notes:
- Chat (including the end-of-game "gg") only goes through when you're logged in
  with a name — Showdown blocks guest chat.
- GPT-5.4-Codex has its own rate-limit pool, separate from the general
  codex limit, so the bot keeps working even when regular codex usage is maxed.
