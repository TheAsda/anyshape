import React from 'react';
import { useConnectionStatus } from 'devtools-protocol/react';

interface ToolbarProps {
  formIds: string[];
  selectedFormId: string | null;
  onSelectForm: (formId: string) => void;
  onTriggerValidation: () => void;
}

export function Toolbar({
  formIds,
  selectedFormId,
  onSelectForm,
  onTriggerValidation,
}: ToolbarProps) {
  const { connected } = useConnectionStatus();

  return (
    <div className="toolbar">
      <div className="toolbar-connection">
        <span className={`toolbar-dot ${connected ? 'connected' : 'disconnected'}`} />
        {connected ? 'Connected' : 'Disconnected'}
      </div>

      {formIds.length > 0 && (
        <select
          className="toolbar-form-select"
          value={selectedFormId ?? ''}
          onChange={(e) => onSelectForm(e.target.value)}
        >
          {formIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      )}

      <div className="toolbar-spacer" />

      <button
        className="toolbar-btn"
        disabled={!connected || !selectedFormId}
        onClick={onTriggerValidation}
      >
        Validate
      </button>
    </div>
  );
}
