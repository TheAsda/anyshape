import React, { useState, useCallback, Fragment } from 'react';

interface JsonViewProps {
  values: Record<string, unknown>;
}

function JsonValue({
  value,
  depth,
  path,
}: {
  value: unknown;
  depth: number;
  path: string;
}) {
  const indent = '  '.repeat(depth);

  if (value === null) {
    return <span className="json-null">null</span>;
  }

  if (value === undefined) {
    return <span className="json-null">undefined</span>;
  }

  if (typeof value === 'string') {
    return <span className="json-string">&quot;{value}&quot;</span>;
  }

  if (typeof value === 'number') {
    return <span className="json-number">{String(value)}</span>;
  }

  if (typeof value === 'boolean') {
    return <span className="json-boolean">{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <Fragment>
          <span className="json-bracket">[</span>
          <span className="json-bracket">]</span>
        </Fragment>
      );
    }
    return <JsonArray value={value} depth={depth} path={path} />;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return (
        <Fragment>
          <span className="json-bracket">{'{}'}</span>
        </Fragment>
      );
    }
    return <JsonObject value={value as Record<string, unknown>} depth={depth} path={path} />;
  }

  return <span>{String(value)}</span>;
}

function JsonObject({
  value,
  depth,
  path,
}: {
  value: Record<string, unknown>;
  depth: number;
  path: string;
}) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const entries = Object.entries(value);
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);

  if (collapsed) {
    return (
      <span>
        <span
          className="json-bracket"
          style={{ cursor: 'pointer' }}
          onClick={() => setCollapsed(false)}
        >
          {'{}'}
        </span>
        <span className="json-collapsed-hint" onClick={() => setCollapsed(false)}>
          {' '}{entries.length} keys
        </span>
      </span>
    );
  }

  return (
    <span>
      <span className="json-bracket" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(true)}>
        {'{'}
      </span>
      {'\n'}
      {entries.map(([key, val], i) => (
        <span key={key}>
          {childIndent}
          <span className="json-key">&quot;{key}&quot;</span>
          {': '}
          <JsonValue value={val} depth={depth + 1} path={`${path}.${key}`} />
          {i < entries.length - 1 && ','}
          {'\n'}
        </span>
      ))}
      {indent}
      <span className="json-bracket">{'}'}</span>
    </span>
  );
}

function JsonArray({
  value,
  depth,
  path,
}: {
  value: unknown[];
  depth: number;
  path: string;
}) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const indent = '  '.repeat(depth);
  const childIndent = '  '.repeat(depth + 1);

  if (collapsed) {
    return (
      <span>
        <span
          className="json-bracket"
          style={{ cursor: 'pointer' }}
          onClick={() => setCollapsed(false)}
        >
          {'[]'}
        </span>
        <span className="json-collapsed-hint" onClick={() => setCollapsed(false)}>
          {' '}{value.length} items
        </span>
      </span>
    );
  }

  return (
    <span>
      <span className="json-bracket" style={{ cursor: 'pointer' }} onClick={() => setCollapsed(true)}>
        {'['}
      </span>
      {'\n'}
      {value.map((val, i) => (
        <span key={i}>
          {childIndent}
          <JsonValue value={val} depth={depth + 1} path={`${path}[${i}]`} />
          {i < value.length - 1 && ','}
          {'\n'}
        </span>
      ))}
      {indent}
      <span className="json-bracket">{']'}</span>
    </span>
  );
}

export function JsonView({ values }: JsonViewProps) {
  const entries = Object.entries(values);

  if (entries.length === 0) {
    return (
      <div>
        <div className="section-header">Values</div>
        <div className="json-view">
          <span className="json-bracket">{'{}'}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header">Values</div>
      <div className="json-view">
        <span className="json-bracket">{'{'}</span>
        {'\n'}
        {entries.map(([key, val], i) => (
          <span key={key}>
            {'  '}
            <span className="json-key">&quot;{key}&quot;</span>
            {': '}
            <JsonValue value={val} depth={1} path={key} />
            {i < entries.length - 1 && ','}
            {'\n'}
          </span>
        ))}
        <span className="json-bracket">{'}'}</span>
      </div>
    </div>
  );
}
