import { ContentScriptBridge } from 'devtools-protocol/content-script';

const bridge = new ContentScriptBridge();
bridge.connect();