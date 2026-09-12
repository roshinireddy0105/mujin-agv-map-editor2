import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Issue,
  ORIENTATIONS,
  OrientationId,
  computeEdges,
  orientationById,
  validateMap,
} from '@agv/shared';
import {
  ApiError,
  downloadUrl,
  fetchMap,
  resetMap,
  saveMap,
} from './lib/api';
import {
  IDENTITY,
  Viewport,
  rotateAbout,
  rotationDegrees,
  zoomAt,
} from './lib/viewport';
import { isDirty, initialState, mapReducer } from './state/mapReducer';
import { MapCanvas } from './components/MapCanvas';
import { Inspector } from './components/Inspector';

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string; issues: Issue[]; conflict: boolean };

export default function App() {
  const [state, dispatch] = useReducer(mapReducer, initialState);
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [checksOpen, setChecksOpen] = useState(false);
  const canvasSize = useRef({ width: 0, height: 0 });

  const orientation = orientationById(state.orientationId);
  const dirty = isDirty(state);

  useEffect(() => {
    let cancelled = false;
    fetchMap()
      .then((resource) => {
        if (cancelled) return;
        dispatch({ type: 'loaded', map: resource.map, revision: resource.revision });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error ? error.message : 'Could not reach the map server.',
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Validation runs client-side on every edit using the same shared module the
   * server enforces on save, so the editor never shows a map as clean that the
   * API would then reject.
   */
  const validation = useMemo(
    () => validateMap(state.map, orientation),
    [state.map, orientation],
  );
  const stats = useMemo(() => {
    const edges = computeEdges(state.map, orientation);
    return { nodeCount: state.map.nodes.length, laneCount: edges.length };
  }, [state.map, orientation]);

  const allIssues = useMemo(
    () => [...validation.errors, ...validation.warnings],
    [validation],
  );
  const flaggedIndices = useMemo(
    () =>
      new Set(
        allIssues
          .map((issue) => issue.nodeIndex)
          .filter((index): index is number => index !== undefined),
      ),
    [allIssues],
  );

  const save = useCallback(async () => {
    setSaveState({ kind: 'saving' });
    try {
      const result = await saveMap(state.map, state.savedRevision, state.orientationId);
      dispatch({ type: 'saved', revision: result.revision });
      setSaveState({ kind: 'saved', at: Date.now() });
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setSaveState({
        kind: 'error',
        message: apiError?.message ?? 'Save failed.',
        issues: apiError?.issues ?? [],
        conflict: apiError?.isConflict ?? false,
      });
    }
  }, [state.map, state.orientationId, state.savedRevision]);

  const reload = useCallback(async () => {
    const resource = await fetchMap();
    dispatch({ type: 'loaded', map: resource.map, revision: resource.revision });
    setSaveState({ kind: 'idle' });
  }, []);

  const restoreSample = useCallback(async () => {
    const resource = await resetMap();
    dispatch({ type: 'loaded', map: resource.map, revision: resource.revision });
    setSaveState({ kind: 'idle' });
  }, []);

  // Keyboard: undo, redo, save, delete, escape out of add mode.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'TEXTAREA');
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
        return;
      }
      if (typing) return;
      if (event.key === 'Escape') setAddMode(false);
      if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedIndex !== null) {
        event.preventDefault();
        dispatch({ type: 'deleteNode', index: state.selectedIndex });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save, state.selectedIndex]);

  // Warn before losing unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const centreOfCanvas = () => ({
    x: canvasSize.current.width / 2,
    y: canvasSize.current.height / 2,
  });

  if (loadError) {
    return (
      <main className="boot-error">
        <h1>The map server is not responding</h1>
        <p>{loadError}</p>
        <p>
          Check that the API is running, then <button type="button" onClick={() => location.reload()}>try again</button>.
        </p>
      </main>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__identity">
          <span className="topbar__mark" aria-hidden="true" />
          <h1>AGV map editor</h1>
          <span className="topbar__count">
            {stats.nodeCount} nodes <span aria-hidden="true">•</span> {stats.laneCount} lanes
          </span>
        </div>

        <div className="topbar__group">
          <button
            type="button"
            className={`button${addMode ? ' button--active' : ''}`}
            onClick={() => setAddMode((on) => !on)}
            aria-pressed={addMode}
          >
            {addMode ? 'Click the map to place' : 'Add node'}
          </button>
          <button
            type="button"
            className="button"
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }))}
            title="Fit the complete map in the canvas (F)"
          >
            Fit map
          </button>
          <button
            type="button"
            className="button"
            onClick={() => dispatch({ type: 'undo' })}
            disabled={state.past.length === 0}
          >
            Undo
          </button>
          <button
            type="button"
            className="button"
            onClick={() => dispatch({ type: 'redo' })}
            disabled={state.future.length === 0}
          >
            Redo
          </button>
        </div>

        <div className="topbar__group">
          <button
            type="button"
            className="button"
            onClick={() => setViewport((v) => zoomAt(v, centreOfCanvas(), 1 / 1.3))}
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setViewport((v) => zoomAt(v, centreOfCanvas(), 1.3))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setViewport((v) => rotateAbout(v, centreOfCanvas(), -Math.PI / 12))}
            aria-label="Rotate anticlockwise"
          >
            ↺
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setViewport((v) => rotateAbout(v, centreOfCanvas(), Math.PI / 12))}
            aria-label="Rotate clockwise"
          >
            ↻
          </button>
          <span className="readout readout--inline">
            {Math.round(rotationDegrees(viewport))}°
          </span>
        </div>

        <label className="orientation">
          <span className="orientation__label">Compass</span>
          <select
            value={state.orientationId}
            onChange={(event) =>
              dispatch({
                type: 'setOrientation',
                orientationId: event.target.value as OrientationId,
              })
            }
          >
            {Object.values(ORIENTATIONS).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="topbar__group topbar__group--end">
          <a className="button" href={downloadUrl} download>
            Download JSON
          </a>
          <button type="button" className="button" onClick={() => void restoreSample()}>
            Restore sample
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => void save()}
            disabled={saveState.kind === 'saving' || !dirty}
          >
            {saveState.kind === 'saving' ? 'Saving' : dirty ? 'Save changes' : 'Saved'}
          </button>
        </div>
      </header>

      <p className="orientation__note">{orientation.note}</p>

      {saveState.kind === 'error' ? (
        <div className="banner banner--error" role="alert">
          <span>{saveState.message}</span>
          {saveState.conflict ? (
            <button type="button" className="button" onClick={() => void reload()}>
              Load the server's version
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="workspace">
        <div
          className="workspace__canvas"
          ref={(element) => {
            if (element) {
              const rect = element.getBoundingClientRect();
              canvasSize.current = { width: rect.width, height: rect.height };
            }
          }}
        >
          <div className="map-heading">
            <div>
              <span className="eyebrow">LIVE MAP</span>
              <strong>Warehouse AGV network</strong>
            </div>
            <div className="map-legend" aria-label="Map legend">
              <span><i className="legend-dot" /> Node</span>
              <span><i className="legend-dot legend-dot--selected" /> Selected</span>
              <span><i className="legend-dot legend-dot--charger" /> Charger</span>
              <span><i className="legend-dot legend-dot--chute" /> Chute</span>
            </div>
          </div>
          <MapCanvas
            map={state.map}
            orientation={orientation}
            selectedIndex={state.selectedIndex}
            flaggedIndices={flaggedIndices}
            viewport={viewport}
            onViewportChange={setViewport}
            onSelect={(index) => dispatch({ type: 'select', index })}
            onMoveNode={(index, x, y, coalesce) =>
              dispatch({ type: 'moveNode', index, x, y, coalesce })
            }
            onAddNode={(x, y) => {
              dispatch({ type: 'addNode', x, y });
              setAddMode(false);
            }}
            onHover={setHover}
            addMode={addMode}
          />
          <div className="readout readout--floating">
            {hover ? (
              <>
                <span>x {hover.x}</span>
                <span>y {hover.y}</span>
                <span className="readout__unit">mm</span>
              </>
            ) : (
              <span className="readout__unit">Move the pointer over the map</span>
            )}
          </div>
        </div>

        <aside className="rail">
          <Inspector
            map={state.map}
            orientation={orientation}
            index={state.selectedIndex}
            issues={allIssues}
            onUpdate={(index, patch) => dispatch({ type: 'updateNode', index, patch })}
            onToggleDirection={(index, direction) =>
              dispatch({ type: 'toggleDirection', index, direction })
            }
            onSetFeature={(index, feature, direction) =>
              dispatch({ type: 'setFeature', index, feature, direction })
            }
            onDelete={(index) => dispatch({ type: 'deleteNode', index })}
          />

          <section className={`rail__issues${checksOpen ? ' rail__issues--open' : ''}`}>
            <button
              type="button"
              className="rail__issues-head"
              onClick={() => setChecksOpen((open) => !open)}
              aria-expanded={checksOpen}
            >
              <span className="rail__issues-title"><span aria-hidden="true">{checksOpen ? '▾' : '▸'}</span> Map checks</span>
              <span>
                {validation.errors.length} blocking, {validation.warnings.length} to review
              </span>
            </button>

            <div className="rail__issues-body">
            <label className="field field--inline">
              <span className="field__label">
                Neighbour limit<span className="field__suffix">mm</span>
              </span>
              <input
                className="field__input field__input--numeric"
                inputMode="numeric"
                value={state.map.maxNeighborDistance}
                onChange={(event) =>
                  dispatch({
                    type: 'setMaxNeighborDistance',
                    value: Number(event.target.value),
                  })
                }
              />
            </label>

            {allIssues.length === 0 ? (
              <p className="rail__clean">No problems found.</p>
            ) : (
              <ul className="issue-list">
                {allIssues.slice(0, 60).map((issue, i) => (
                  <li
                    key={`${issue.code}-${i}`}
                    className={`issue issue--${issue.severity}`}
                    onClick={() =>
                      issue.nodeIndex !== undefined &&
                      dispatch({ type: 'select', index: issue.nodeIndex })
                    }
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
