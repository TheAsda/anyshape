import React, { useRef, useEffect } from 'react';
import type { FormMutationPayload } from './protocol';

interface LogEvent extends FormMutationPayload {
  _seq: number;
}

interface EventLogProps {
  events: LogEvent[];
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${h}:${m}:${s}.${ms}`;
}

export type { LogEvent };

export function EventLog({ events }: EventLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  return (
    <div>
      <div className="section-header">Event Log</div>
      <div className="event-log">
        {events.length === 0 && (
          <div className="empty-state">No events yet</div>
        )}
        {events.map((evt) => (
          <div className="event-entry" key={evt._seq}>
            <span className="event-time">{formatTime(evt.timestamp)}</span>
            <span className={`event-type ${evt.type}`}>{evt.type}</span>
            <span className="event-spec-id">{evt.specId}</span>
            {evt.detail && <span className="event-detail">{evt.detail}</span>}
            <span className="event-form-id">{evt.formId}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
