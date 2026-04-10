console.log('[BG] Background script loading...');

import { BackgroundRouter } from 'devtools-protocol/background';

const origAddListener = chrome.runtime.onConnect.addListener.bind(chrome.runtime.onConnect);

chrome.runtime.onConnect.addListener(function(port) {
  const tabId = (port.sender?.tab?.id) ?? 'unknown';
  const tabIdFromName = Number(port.name);
  const isContentScript = port.name === 'devtools-protocol-proxy';
  const isPanel = !isNaN(tabIdFromName) && port.name !== 'devtools-protocol-proxy';
  const label = isContentScript ? 'CS' : isPanel ? 'PANEL' : 'UNKNOWN';

  console.log('[BG] Connection —', label, 'name:', port.name, 'tab:', tabId);

  port.onMessage.addListener(function(msg) {
    console.log('[BG] MSG', label, '(' + port.name + ')', 'type:', msg.type, 'method:', msg.method);
  });

  port.onDisconnect.addListener(function() {
    console.log('[BG] Disconnect —', label, port.name);
  });
});

const router = new BackgroundRouter();
router.start();
console.log('[BG] BackgroundRouter started, listening for connections...');
