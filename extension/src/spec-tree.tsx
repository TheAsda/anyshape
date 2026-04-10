import React, { useState, useCallback } from 'react';

interface SpecNode {
  kind?: string;
  id?: string;
  path?: string;
  children?: Record<string, SpecNode>;
  [key: string]: unknown;
}

interface SpecTreeProps {
  specTree: Record<string, unknown>;
  mounted: string[];
  touched: Record<string, boolean>;
  errors: Record<string, string | null>;
  selectedSpecId: string | null;
  onSelectSpec: (specId: string | null) => void;
}

function isSpecNode(value: unknown): value is SpecNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getKindIcon(kind: string | undefined): { char: string; cls: string } {
  switch (kind) {
    case 'field': return { char: 'F', cls: 'field' };
    case 'object': return { char: 'O', cls: 'object' };
    case 'array': return { char: 'A', cls: 'array' };
    case 'meta': return { char: 'M', cls: 'meta' };
    default: return { char: '?', cls: 'default' };
  }
}

function SpecNodeRow({
  nodeKey,
  node,
  mounted,
  touched,
  errors,
  selectedSpecId,
  onSelectSpec,
  depth,
}: {
  nodeKey: string;
  node: SpecNode;
  mounted: string[];
  touched: Record<string, boolean>;
  errors: Record<string, string | null>;
  selectedSpecId: string | null;
  onSelectSpec: (specId: string | null) => void;
  depth: number;
}) {
  const hasChildren = node.children && Object.keys(node.children).length > 0;
  const [collapsed, setCollapsed] = useState(false);

  const specId = node.id ?? nodeKey;
  const kind = node.kind;
  const icon = getKindIcon(kind);
  const isSelected = selectedSpecId === specId;

  const isMounted = mounted.includes(specId);
  const isTouched = touched[specId] === true;
  const hasError = errors[specId] != null;

  const handleClick = useCallback(() => {
    if (hasChildren) {
      setCollapsed((prev) => !prev);
    }
    onSelectSpec(specId);
  }, [hasChildren, onSelectSpec, specId]);

  return (
    <div className="spec-node">
      <div
        className={`spec-node-row${isSelected ? ' selected' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
        onClick={handleClick}
      >
        {hasChildren ? (
          <span className="spec-toggle">{collapsed ? '▶' : '▼'}</span>
        ) : (
          <span className="spec-toggle-placeholder" />
        )}
        <span className={`spec-icon ${icon.cls}`}>{icon.char}</span>
        <span className="spec-id">{specId}</span>
        {node.path && <span className="spec-path">{node.path}</span>}
        {isMounted && <span className="spec-badge mounted" />}
        {isTouched && <span className="spec-badge touched" />}
        {hasError && <span className="spec-badge has-error" />}
      </div>
      {hasChildren && !collapsed && (
        <div className="spec-children">
          {Object.entries(node.children!).map(([key, child]) => (
            <SpecNodeRow
              key={key}
              nodeKey={key}
              node={child}
              mounted={mounted}
              touched={touched}
              errors={errors}
              selectedSpecId={selectedSpecId}
              onSelectSpec={onSelectSpec}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function SpecTree({
  specTree,
  mounted,
  touched,
  errors,
  selectedSpecId,
  onSelectSpec,
}: SpecTreeProps) {
  const entries = Object.entries(specTree);

  if (entries.length === 0) {
    return <div className="empty-state">Empty spec tree</div>;
  }

  return (
    <div className="spec-tree">
      <div className="section-header">Spec Tree</div>
      {entries.map(([key, value]) => {
        const node: SpecNode = isSpecNode(value) ? value : { id: key };
        return (
          <SpecNodeRow
            key={key}
            nodeKey={key}
            node={node}
            mounted={mounted}
            touched={touched}
            errors={errors}
            selectedSpecId={selectedSpecId}
            onSelectSpec={onSelectSpec}
            depth={0}
          />
        );
      })}
    </div>
  );
}
