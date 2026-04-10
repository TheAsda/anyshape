import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PanelTransport } from 'devtools-protocol/panel';
import {
  DevToolsProvider,
  useConnection,
  useConnectionStatus,
} from 'devtools-protocol/react';
import { formDevtoolsProtocol } from './protocol';
import type {
  FormDevtoolsProtocol,
  FormRegisteredPayload,
  FormStateChangedPayload,
  FormMutationPayload,
} from './protocol';
import { Toolbar } from './toolbar';
import { SpecTree } from './spec-tree';
import { JsonView } from './json-view';
import { EventLog } from './event-log';
import type { LogEvent } from './event-log';

interface FormState {
  specTree: Record<string, unknown>;
  values: Record<string, unknown>;
  errors: Record<string, string | null>;
  touched: Record<string, boolean>;
  mounted: string[];
}

const EMPTY_FORM_STATE: FormState = {
  specTree: {},
  values: {},
  errors: {},
  touched: {},
  mounted: [],
};

const tabId = chrome.devtools.inspectedWindow.tabId;
const transport = new PanelTransport(tabId);

function PanelContent() {
  const connection = useConnection<FormDevtoolsProtocol>();
  const { connected } = useConnectionStatus();

  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [selectedSpecId, setSelectedSpecId] = useState<string | null>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    connection.handle('formRegistered', (payload: FormRegisteredPayload) => {
      setForms((prev) => ({
        ...prev,
        [payload.formId]: {
          ...(prev[payload.formId] ?? EMPTY_FORM_STATE),
          specTree: payload.specTree,
        },
      }));
      setSelectedFormId((prev) => prev ?? payload.formId);
    });

    connection.handle(
      'formStateChanged',
      (payload: FormStateChangedPayload) => {
        setForms((prev) => ({
          ...prev,
          [payload.formId]: {
            ...(prev[payload.formId] ?? { specTree: {} }),
            values: payload.values,
            errors: payload.errors,
            touched: payload.touched,
            mounted: payload.mounted,
          },
        }));
      },
    );

    connection.handle('formMutation', (payload: FormMutationPayload) => {
      const seq = ++seqRef.current;
      setEvents((prev) => {
        const next: LogEvent[] = [...prev, { ...payload, _seq: seq }];
        return next.length > 100 ? next.slice(-100) : next;
      });
    });
  }, [connection]);

  const handleTriggerValidation = useCallback(() => {
    if (selectedFormId) {
      connection.send('triggerValidation', { formId: selectedFormId });
    }
  }, [connection, selectedFormId]);

  const currentForm = selectedFormId ? forms[selectedFormId] : null;
  const formIds = Object.keys(forms);

  return (
    <div className="panel">
      <Toolbar
        formIds={formIds}
        selectedFormId={selectedFormId}
        onSelectForm={setSelectedFormId}
        onTriggerValidation={handleTriggerValidation}
      />
      <div className="panel-body">
        <div className="panel-left">
          {currentForm ? (
            <SpecTree
              specTree={currentForm.specTree}
              mounted={currentForm.mounted}
              touched={currentForm.touched}
              errors={currentForm.errors}
              selectedSpecId={selectedSpecId}
              onSelectSpec={setSelectedSpecId}
            />
          ) : (
            <div className="empty-state">
              {connected ? 'Waiting for form registration...' : 'Not connected'}
            </div>
          )}
        </div>
        <div className="panel-right">
          <div className="panel-right-top">
            {currentForm ? (
              <JsonView values={currentForm.values} />
            ) : (
              <div>
                <div className="section-header">Values</div>
                <div className="empty-state">No data</div>
              </div>
            )}
          </div>
          <div className="panel-right-bottom">
            <EventLog events={events} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function PanelApp() {
  return (
    <DevToolsProvider protocol={formDevtoolsProtocol} transport={transport}>
      <PanelContent />
    </DevToolsProvider>
  );
}
