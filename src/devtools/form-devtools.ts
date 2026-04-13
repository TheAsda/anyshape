import type { FormStore } from '../store/form-store.js';
import { formDevtoolsProtocol } from './protocol.js';
import { createPageConnection } from 'devtools-protocol/page';

type ProtocolConnection = ReturnType<typeof createPageConnection<typeof formDevtoolsProtocol>>;

const DEBUG = true;
function log(...args: unknown[]) { if (DEBUG) console.log('[FormDevtools]', ...args); }

export class FormDevtools {
  private store: FormStore;
  private connection: ProtocolConnection;
  private formId: string;
  private unsubscribes: Array<() => void> = [];

  constructor(store: FormStore, formId?: string) {
    this.store = store;
    this.formId = formId ?? `form_${Date.now()}`;
    log('constructor — formId:', this.formId, 'connected:', store.getSpecs().length, 'specs');

    this.connection = createPageConnection({
      protocol: formDevtoolsProtocol,
    });
    log('constructor — PageTransport created');
  }

  async connect(): Promise<void> {
    log('connect() — calling connection.connect()...');
    await this.connection.connect();
    log('connect() — connected! transport.connected:', this.connection.connected);

    const specTree = this.store.getSpecTree();
    log('connect() — sending formRegistered, specTree keys:', Object.keys(specTree));
    this.connection.send('formRegistered', {
      formId: this.formId,
      specTree,
    });
    log('connect() — formRegistered sent');

    this.sendStateSnapshot();

    const specs = this.store.getSpecs();
    log('connect() — subscribing to', specs.length, 'specs');
    for (const spec of specs) {
      const prevValue = this.store.get(spec);
      const unsub = this.store.subscribe(spec, () => {
        const newValue = this.store.get(spec);
        const changed = prevValue !== newValue;
        if (changed) {
          this.connection.send('formMutation', {
            formId: this.formId,
            timestamp: Date.now(),
            type: 'set' as const,
            specId: spec.id,
          });
        }
        this.sendStateSnapshot();
      });
      this.unsubscribes.push(unsub);
    }

    this.connection.handle('triggerValidation', (payload: { formId: string }) => {
      log('handle — triggerValidation received, formId:', payload.formId);
      if (payload.formId === this.formId) {
        this.store.validateTree();
        this.sendStateSnapshot();
      }
    });

    this.connection.handle('requestState', () => {
      log('handle — requestState received, sending full snapshot');
      this.connection.send('formRegistered', {
        formId: this.formId,
        specTree: this.store.getSpecTree(),
      });
      this.sendStateSnapshot();
    });
    log('connect() — done, all handlers registered');
  }

  disconnect(): void {
    log('disconnect()');
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.connection.disconnect();
  }

  private sendStateSnapshot(): void {
    const snapshot = this.store.getDevtoolsSnapshot();
    log('sendStateSnapshot — values keys:', Object.keys(snapshot.values).length,
      'errors:', Object.keys(snapshot.errors).length,
      'mounted:', snapshot.mounted.length);
    this.connection.send('formStateChanged', {
      formId: this.formId,
      ...snapshot,
    });
  }
}
