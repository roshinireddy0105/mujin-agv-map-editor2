import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AgvMap,
  Edge,
  computeEdges,
  screenBounds,
  type Orientation,
} from '@agv/shared';
import {
  Viewport,
  fitBounds,
  mmPerPixel,
  panBy,
  rotationDegrees,
  transformString,
  viewToWorld,
  zoomAt,
} from '../lib/viewport';
import { snapToAlignment } from '../lib/snap';
import { NodeMarker } from './NodeMarker';

export interface MapCanvasProps {
  map: AgvMap;
  orientation: Orientation;
  selectedIndex: number | null;
  flaggedIndices: Set<number>;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  onSelect: (index: number | null) => void;
  onMoveNode: (index: number, x: number, y: number, coalesce: boolean) => void;
  onAddNode: (x: number, y: number) => void;
  /** Live pointer position in map millimetres, for the readout. */
  onHover: (position: { x: number; y: number } | null) => void;
  addMode: boolean;
}

type Gesture =
  | { kind: 'idle' }
  | { kind: 'pan'; pointerId: number; lastX: number; lastY: number }
  | {
      kind: 'drag';
      pointerId: number;
      index: number;
      /** Offset between the pointer and the node, in map mm, so the node doesn't jump. */
      offsetX: number;
      offsetY: number;
      moved: boolean;
    };

const ZOOM_STEP = 1.0015;
/** On-screen pull radius for snapping, converted to mm at the current zoom. */
const SNAP_PIXELS = 12;

export function MapCanvas({
  map,
  orientation,
  selectedIndex,
  flaggedIndices,
  viewport,
  onViewportChange,
  onSelect,
  onMoveNode,
  onAddNode,
  onHover,
  addMode,
}: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const [snapHint, setSnapHint] = useState<{ x: number; y: number } | null>(null);

  const edges = useMemo(() => computeEdges(map, orientation), [map, orientation]);
  const bounds = useMemo(() => screenBounds(map.nodes, orientation), [map.nodes, orientation]);
  const scaleMm = mmPerPixel(viewport);
  const labelRotation = -rotationDegrees(viewport);

  // Track the element size so fit-to-view and pointer maths use real pixels.
  useEffect(() => {
    const element = svgRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Pointer position in view pixels, relative to the SVG box. */
  const toViewPoint = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }, []);

  const toMapPoint = useCallback(
    (event: { clientX: number; clientY: number }) =>
      orientation.fromScreen(viewToWorld(toViewPoint(event), viewport)),
    [orientation, toViewPoint, viewport],
  );

  /**
   * Wheel zoom is anchored at the cursor, and uses deltaY directly rather than
   * fixed steps so a trackpad pinch feels continuous.
   */
  const handleWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const factor = Math.pow(ZOOM_STEP, -event.deltaY);
      onViewportChange(zoomAt(viewport, toViewPoint(event), factor));
    },
    [onViewportChange, toViewPoint, viewport],
  );

  const handleBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.button !== 0 && event.button !== 1) return;
      if (addMode && event.button === 0) {
        const position = toMapPoint(event);
        const snapped = snapToAlignment(position, map, null, SNAP_PIXELS * scaleMm);
        onAddNode(snapped.x, snapped.y);
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = {
        kind: 'pan',
        pointerId: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
      onSelect(null);
    },
    [addMode, map, onAddNode, onSelect, scaleMm, toMapPoint],
  );

  const handleNodePointerDown = useCallback(
    (index: number, event: React.PointerEvent<SVGGElement>) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      const node = map.nodes[index];
      if (!node) return;
      const pointer = toMapPoint(event);
      (event.currentTarget as unknown as SVGGElement).ownerSVGElement?.setPointerCapture(
        event.pointerId,
      );
      gesture.current = {
        kind: 'drag',
        pointerId: event.pointerId,
        index,
        offsetX: node.x - pointer.x,
        offsetY: node.y - pointer.y,
        moved: false,
      };
      onSelect(index);
    },
    [map.nodes, onSelect, toMapPoint],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const active = gesture.current;
      onHover(toMapPoint(event));

      if (active.kind === 'pan' && active.pointerId === event.pointerId) {
        onViewportChange(
          panBy(viewport, event.clientX - active.lastX, event.clientY - active.lastY),
        );
        gesture.current = { ...active, lastX: event.clientX, lastY: event.clientY };
        return;
      }

      if (active.kind === 'drag' && active.pointerId === event.pointerId) {
        const pointer = toMapPoint(event);
        const snapped = snapToAlignment(
          { x: pointer.x + active.offsetX, y: pointer.y + active.offsetY },
          map,
          active.index,
          SNAP_PIXELS * scaleMm,
        );
        // Coalesce after the first move so a whole drag is one undo step.
        onMoveNode(active.index, snapped.x, snapped.y, active.moved);
        gesture.current = { ...active, moved: true };
        setSnapHint(
          snapped.snappedX || snapped.snappedY ? { x: snapped.x, y: snapped.y } : null,
        );
      }
    },
    [map, onHover, onMoveNode, onViewportChange, scaleMm, toMapPoint, viewport],
  );

  const endGesture = useCallback(() => {
    gesture.current = { kind: 'idle' };
    setSnapHint(null);
  }, []);

  const fit = useCallback(() => {
    if (!bounds || size.width === 0) return;
    onViewportChange(fitBounds(bounds, size.width, size.height));
  }, [bounds, onViewportChange, size.height, size.width]);

  // Frame the map once, as soon as both the map and the element size are known.
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || !bounds || size.width === 0) return;
    framed.current = true;
    fit();
  }, [bounds, fit, size.width]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'f' && !event.metaKey && !event.ctrlKey) fit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fit]);

  return (
    <svg
      ref={svgRef}
      className={`canvas${addMode ? ' canvas--adding' : ''}`}
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => onHover(null)}
      data-testid="map-canvas"
      aria-label="AGV map"
    >
      <g transform={transformString(viewport)}>
        {snapHint ? <SnapGuides position={snapHint} orientation={orientation} /> : null}

        <g className="lanes">
          {edges.map((edge) => (
            <Lane key={edge.id} edge={edge} map={map} orientation={orientation} mm={scaleMm} />
          ))}
        </g>

        <g className="nodes">
          {map.nodes.map((node, index) => (
            <NodeMarker
              key={`${node.x}:${node.y}:${index}`}
              node={node}
              index={index}
              orientation={orientation}
              selected={index === selectedIndex}
              flagged={flaggedIndices.has(index)}
              labelRotation={labelRotation}
              mmPerPixel={scaleMm}
              showLabels={viewport.scale > 0.012}
              onPointerDown={handleNodePointerDown}
            />
          ))}
        </g>
      </g>
    </svg>
  );
}

/**
 * Lane rendering encodes drivability rather than decorating it: a lane that can
 * only be driven one way is dashed on the blocked side, and a lane no AGV can
 * drive at all is drawn faintly, because it is adjacency without being a route.
 */
function Lane({
  edge,
  map,
  orientation,
  mm,
}: {
  edge: Edge;
  map: AgvMap;
  orientation: Orientation;
  mm: number;
}) {
  const a = orientation.toScreen(map.nodes[edge.a]);
  const b = orientation.toScreen(map.nodes[edge.b]);
  const bothWays = edge.passableAB && edge.passableBA;
  const dead = !edge.passableAB && !edge.passableBA;
  const classes = ['lane'];
  if (dead) classes.push('lane--dead');
  else if (!bothWays) classes.push('lane--oneway');

  return (
    <line
      className={classes.join(' ')}
      x1={a.sx}
      y1={a.sy}
      x2={b.sx}
      y2={b.sy}
      strokeWidth={(dead ? 1.2 : 2.4) * mm}
      strokeDasharray={dead ? `${6 * mm} ${6 * mm}` : undefined}
    />
  );
}

/** Crosshair showing which row and column a dragged node has locked onto. */
function SnapGuides({
  position,
  orientation,
}: {
  position: { x: number; y: number };
  orientation: Orientation;
}) {
  const { sx, sy } = orientation.toScreen(position);
  const reach = 400000;
  return (
    <g className="snap-guides">
      <line x1={sx} y1={sy - reach} x2={sx} y2={sy + reach} />
      <line x1={sx - reach} y1={sy} x2={sx + reach} y2={sy} />
    </g>
  );
}
