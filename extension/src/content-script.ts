console.log('[CS] Content script loading...');

import { ContentScriptBridge } from 'devtools-protocol/content-script';

const origPostMessage = window.postMessage.bind(window);
let msgCount = 0;
window.postMessage = function(data: unknown, ...rest: unknown[]) {
  if (data && typeof data === 'object' && '__devtoolsProtocol' in (data as object)) {
    const envelope = data as { type?: string; method?: string };
    console.log('[CS] window.postMessage →', envelope.type, envelope.method);
    msgCount++;
  }
  return (origPostMessage as any)(data, ...rest);
};
console.log('[CS] window.postMessage intercepted for logging');

const bridge = new ContentScriptBridge();
bridge.connect();
console.log('[CS] ContentScriptBridge connected');
