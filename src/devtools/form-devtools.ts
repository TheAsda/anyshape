import type { FormStore } from '../store/form-store.js';
import { formDevtoolsProtocol } from './protocol.js';
import { createPageConnection } from 'devtools-protocol/page';

type ProtocolConnection = ReturnType<typeof createPageConnection<typeof formDevtoolsProtocol>>;

export class FormDevtools {
  private store: FormStore;
  private connection: ProtocolConnection;
  private formId: string;
  private unsubscribes: Array<() => void> = [];

  constructor(store: FormStore, formId?: string) {
    this.store = store;
    this.formId = formId ?? `form_${Date.now()}`;

    this.connection = createPageConnection({
      protocol: formDevtoolsProtocol,
    });
  }

  async connect(): Promise<void> {
    await this.connection.connect();

    this.connection.send('formRegistered', {
      formId: this.formId,
      specTree: this.store.getSpecTree(),
    });

    this.sendStateSnapshot();

    const specIds = this.store.getSpecIds();
    for (const specId of specIds) {
      const unsub = this.store.subscribe(specId, () => {
        this.sendStateSnapshot();
      });
      this.unsubscribes.push(unsub);
    }

    this.connection.handle('triggerValidation', (payload: { formId: string }) => {
      if (payload.formId === this.formId) {
        this.store.validateTree();
        this.sendStateSnapshot();
      }
    });
  }

  disconnect(): void {
    for (const unsub of this.unsubscribes) {
      unsub();
    }
    this.unsubscribes = [];
    this.connection.disconnect();
  }

  private sendStateSnapshot(): void {
    const snapshot = this.store.getDevtoolsSnapshot();
    this.connection.send('formStateChanged', {
      formId: this.formId,
      ...snapshot,
    });
  }
}
