import { defineProtocol, defineMessage } from 'devtools-protocol/page';
import { z } from 'zod/v4';

export const formDevtoolsProtocol = defineProtocol({
  formRegistered: defineMessage({
    payload: z.object({
      formId: z.string(),
      specTree: z.record(z.string(), z.unknown()),
    }),
    direction: 'page->panel',
  }),

  formStateChanged: defineMessage({
    payload: z.object({
      formId: z.string(),
      values: z.record(z.string(), z.unknown()),
      errors: z.record(z.string(), z.union([z.string(), z.null()])),
      touched: z.record(z.string(), z.boolean()),
      mounted: z.array(z.string()),
    }),
    direction: 'page->panel',
  }),

  formMutation: defineMessage({
    payload: z.object({
      formId: z.string(),
      timestamp: z.number(),
      type: z.enum(['set', 'reset', 'mount', 'unmount', 'validate']),
      specId: z.string(),
      detail: z.string().optional(),
    }),
    direction: 'page->panel',
  }),

  triggerValidation: defineMessage({
    payload: z.object({
      formId: z.string(),
    }),
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
