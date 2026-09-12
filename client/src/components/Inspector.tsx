import { useEffect, useState } from 'react';
import {
  DIRECTIONS,
  Direction,
  Issue,
  MapNode,
  availableDirections,
  type AgvMap,
  type Orientation,
} from '@agv/shared';

export interface InspectorProps {
  map: AgvMap;
  orientation: Orientation;
  index: number | null;
  issues: Issue[];
  onUpdate: (index: number, patch: Partial<MapNode>) => void;
  onToggleDirection: (index: number, direction: Direction) => void;
  onSetFeature: (
    index: number,
    feature: 'charger' | 'chute',
    direction: Direction | null,
  ) => void;
  onDelete: (index: number) => void;
}

export function Inspector({
  map,
  orientation,
  index,
  issues,
  onUpdate,
  onToggleDirection,
  onSetFeature,
  onDelete,
}: InspectorProps) {
  if (index === null || !map.nodes[index]) {
    return (
      <div className="rail__empty">
        <span className="eyebrow">NODE DETAILS</span>
        <h2>Pick a node to edit</h2>
        <p>Choose any circle on the map to inspect its QR code, position, travel directions, and special equipment.</p>
        <div className="rail__guide">
          <div><strong>1</strong><span>Select a node</span></div>
          <div><strong>2</strong><span>Edit its properties</span></div>
          <div><strong>3</strong><span>Save through the API</span></div>
        </div>
        <p className="rail__empty-hint">
          Tip: drag the floor to pan, scroll to zoom, and drag a node to reposition it.
        </p>
      </div>
    );
  }

  const node = map.nodes[index];
  const reachable = new Set(availableDirections(map, index, orientation));
  const nodeIssues = issues.filter((issue) => issue.nodeIndex === index);

  return (
    <div className="inspector" data-testid="inspector">
      <div className="inspector__head">
        <div><span className="eyebrow">NODE DETAILS</span><h2>{node.name || `Node ${node.code}`}</h2></div>
        <button
          type="button"
          className="button button--danger"
          onClick={() => onDelete(index)}
          aria-label="Delete this node"
        >
          Delete node
        </button>
      </div>

      <h3 className="section-title">Position</h3>
      <div className="field-row">
        <NumberField
          label="x"
          suffix="mm"
          value={node.x}
          onCommit={(value) => onUpdate(index, { x: value })}
        />
        <NumberField
          label="y"
          suffix="mm"
          value={node.y}
          onCommit={(value) => onUpdate(index, { y: value })}
        />
      </div>

      <h3 className="section-title">Identity</h3>
      <NumberField
        label="QR code"
        value={node.code}
        hint="0 means no code assigned yet."
        onCommit={(value) => onUpdate(index, { code: value })}
      />

      <TextField
        label="Name"
        value={node.name ?? ''}
        placeholder="Unnamed"
        onCommit={(value) => onUpdate(index, { name: value })}
      />

      <fieldset className="group inspector-section">
        <legend>Travel directions</legend>
        <p className="group__hint">Headings an AGV may leave this node on.</p>
        <div className="chips">
          {DIRECTIONS.map((direction) => {
            const active = node.directions?.includes(direction) ?? false;
            const dangling = active && !reachable.has(direction);
            return (
              <button
                key={direction}
                type="button"
                role="switch"
                aria-checked={active}
                className={`chip${active ? ' chip--on' : ''}${
                  dangling ? ' chip--dangling' : ''
                }`}
                onClick={() => onToggleDirection(index, direction)}
                title={
                  dangling
                    ? `No neighbour to the ${direction}, so this heading leads nowhere.`
                    : undefined
                }
              >
                {direction}
              </button>
            );
          })}
        </div>
      </fieldset>

      <h3 className="section-title">Special equipment</h3>
      <FeatureField
        label="Charger"
        hint="Plug direction. The AGV reverses in from that side."
        value={node.charger?.direction ?? null}
        onChange={(direction) => onSetFeature(index, 'charger', direction)}
      />

      <FeatureField
        label="Chute"
        hint="Direction the payload travels when ejected."
        value={node.chute?.direction ?? null}
        onChange={(direction) => onSetFeature(index, 'chute', direction)}
      />

      {nodeIssues.length > 0 ? (
        <ul className="inspector__issues">
          {nodeIssues.map((issue, i) => (
            <li key={`${issue.code}-${i}`} className={`issue issue--${issue.severity}`}>
              {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Numeric field that keeps its own draft while you type and only commits a
 * parsed value on blur or Enter. Committing on every keystroke would make
 * "1000" pass through 1 and 10, each a valid position that would relocate the
 * node and rewrite the lane graph mid-edit.
 */
function NumberField({
  label,
  value,
  suffix,
  hint,
  onCommit,
}: {
  label: string;
  value: number;
  suffix?: string;
  hint?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && Math.round(parsed) !== value) onCommit(Math.round(parsed));
    else setDraft(String(value));
  };

  return (
    <label className="field">
      <span className="field__label">
        {label}
        {suffix ? <span className="field__suffix">{suffix}</span> : null}
      </span>
      <input
        className="field__input field__input--numeric"
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setDraft(String(value));
        }}
      />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input"
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => draft !== value && onCommit(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft !== value) onCommit(draft);
          if (event.key === 'Escape') setDraft(value);
        }}
      />
    </label>
  );
}

function FeatureField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: Direction | null;
  onChange: (direction: Direction | null) => void;
}) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <select
        className="field__input"
        aria-label={label}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? null : (event.target.value as Direction))
        }
      >
        <option value="">None</option>
        {DIRECTIONS.map((direction) => (
          <option key={direction} value={direction}>
            {direction}
          </option>
        ))}
      </select>
      <span className="field__hint">{hint}</span>
    </label>
  );
}
