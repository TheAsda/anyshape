import { defineProtocol, defineMessage } from 'devtools-protocol/page';

export const formDevtoolsProtocol = defineProtocol({
  formRegistered: defineMessage({
    payload: undefined as any,
    direction: 'page->panel',
  }),

  formStateChanged: defineMessage({
    payload: undefined as any,
    direction: 'page->panel',
  }),

  formMutation: defineMessage({
    payload: undefined as any,
    direction: 'page->panel',
  }),

  triggerValidation: defineMessage({
    payload: undefined as any,
    direction: 'panel->page',
  }),

  requestState: defineMessage({
    payload: undefined as any,
    direction: 'panel->page',
  }),
});

export type FormDevtoolsProtocol = typeof formDevtoolsProtocol;

export interface FormRegisteredPayload {
  formId: string;
  specTree: Record<string, unknown>;
}

export interface FormStateChangedPayload {
  formId: string;
  specTree: Record<string, unknown>;
  values: Record<string, unknown>;
  errors: Record<string, string | null>;
  touched: Record<string, boolean>;
  mounted: string[];
}

export interface FormMutationPayload {
  formId: string;
  timestamp: number;
  type: 'set' | 'reset' | 'mount' | 'unmount' | 'validate';
  specId: string;
  detail?: string;
}
