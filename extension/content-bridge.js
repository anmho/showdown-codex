// Isolated-world bridge: relays state events from the page (content-main.js)
// to the background service worker, and decisions back to the page.
(() => {
  let port = null;

  const connect = () => {
    port = chrome.runtime.connect({ name: 'sdx' });
    port.onMessage.addListener((msg) => {
      if (msg && msg.type === 'act') {
        window.dispatchEvent(new CustomEvent('sdx_act', { detail: msg.detail }));
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
    });
  };

  window.addEventListener('sdx_state', (e) => {
    try {
      if (!port) connect();
      port.postMessage({ type: 'state', detail: e.detail });
    } catch (err) {
      port = null;
      try {
        connect();
        port.postMessage({ type: 'state', detail: e.detail });
      } catch (err2) {
        console.warn('[SDX bridge] failed to reach background:', err2);
      }
    }
  });

  connect();
})();
