import { memo } from 'react';
import {
  DIRECTIONS,
  Direction,
  MapNode,
  SCREEN_DIRECTION_VECTORS,
  type Orientation,
} from '@agv/shared';

export interface NodeMarkerProps {
  node: MapNode;
  index: number;
  orientation: Orientation;
  selected: boolean;
  flagged: boolean;
  /** Counter-rotation in degrees, so labels stay readable when the map is turned. */
  labelRotation: number;
  /** Millimetres per pixel, so glyphs keep a constant on-screen size. */
  mmPerPixel: number;
  showLabels: boolean;
  onPointerDown: (index: number, event: React.PointerEvent<SVGGElement>) => void;
}

/** Marker geometry in millimetres at 1:1; scaled by mmPerPixel to stay legible. */
const BASE_RADIUS_PX = 7;
const ARROW_LENGTH_PX = 16;
const ARROW_HEAD_PX = 5;

function arrowPath(direction: Direction, length: number, head: number): string {
  const { dx, dy } = SCREEN_DIRECTION_VECTORS[direction];
  const tipX = dx * length;
  const tipY = dy * length;
  // Perpendicular, for the two barbs.
  const px = -dy;
  const py = dx;
  const baseX = tipX - dx * head;
  const baseY = tipY - dy * head;
  return [
    `M 0 0 L ${tipX} ${tipY}`,
    `M ${tipX} ${tipY} L ${baseX + px * head * 0.6} ${baseY + py * head * 0.6}`,
    `M ${tipX} ${tipY} L ${baseX - px * head * 0.6} ${baseY - py * head * 0.6}`,
  ].join(' ');
}

/**
 * A single node.
 *
 * Everything is drawn in *drawing units* (millimetres) inside a group that the
 * parent has already transformed, so this component never has to know about
 * pan, zoom or rotation — only `mmPerPixel`, which keeps glyphs a constant size
 * on screen, and `labelRotation`, which keeps text upright.
 */
function NodeMarkerImpl({
  node,
  index,
  orientation,
  selected,
  flagged,
  labelRotation,
  mmPerPixel,
  showLabels,
  onPointerDown,
}: NodeMarkerProps) {
  const { sx, sy } = orientation.toScreen(node);
  const radius = BASE_RADIUS_PX * mmPerPixel;
  const arrowLength = ARROW_LENGTH_PX * mmPerPixel;
  const arrowHead = ARROW_HEAD_PX * mmPerPixel;
  const directions = node.directions ?? [];

  const classes = ['node'];
  if (selected) classes.push('node--selected');
  if (flagged) classes.push('node--flagged');
  if (node.charger) classes.push('node--charger');
  if (node.chute) classes.push('node--chute');

  return (
    <g
      className={classes.join(' ')}
      transform={`translate(${sx} ${sy})`}
      onPointerDown={(event) => onPointerDown(index, event)}
      role="button"
      tabIndex={-1}
      aria-label={`Node ${node.code}${node.name ? ` ${node.name}` : ''} at ${node.x}, ${node.y}`}
      data-testid={`node-${index}`}
    >
      {/* Generous invisible hit area: the visible dot is small at low zoom. */}
      <circle className="node__hit" r={Math.max(radius * 2, 14 * mmPerPixel)} />

      {directions.map((direction) => (
        <path
          key={direction}
          className="node__arrow"
          d={arrowPath(direction, arrowLength, arrowHead)}
          strokeWidth={1.6 * mmPerPixel}
          fill="none"
        />
      ))}

      {node.charger ? (
        <ChargerGlyph
          direction={node.charger.direction}
          radius={radius}
          mmPerPixel={mmPerPixel}
        />
      ) : null}

      {node.chute ? (
        <ChuteGlyph direction={node.chute.direction} radius={radius} mmPerPixel={mmPerPixel} />
      ) : null}

      <circle className="node__dot" r={radius} strokeWidth={1.6 * mmPerPixel} />

      {selected ? (
        <circle
          className="node__ring"
          r={radius * 2.4}
          strokeWidth={1.6 * mmPerPixel}
          fill="none"
        />
      ) : null}

      {(showLabels || selected || node.charger || node.chute) && node.name ? (
        <g transform={`rotate(${labelRotation})`}>
          <rect
            className="node__label-bg"
            x={-Math.max(24, node.name.length * 3.7) * mmPerPixel}
            y={-radius * 4.25}
            width={Math.max(48, node.name.length * 7.4) * mmPerPixel}
            height={16 * mmPerPixel}
            rx={4 * mmPerPixel}
          />
          <text
            className="node__name"
            x={0}
            y={-radius * 2.6}
            fontSize={12 * mmPerPixel}
            textAnchor="middle"
          >
            {node.name}
          </text>
        </g>
      ) : null}
    </g>
  );
}

/**
 * The plug, drawn as a bar across the lane on the side the plug faces, with the
 * docking arrow pointing the way the AGV reverses — the opposite heading.
 */
function ChargerGlyph({
  direction,
  radius,
  mmPerPixel,
}: {
  direction: Direction;
  radius: number;
  mmPerPixel: number;
}) {
  const { dx, dy } = SCREEN_DIRECTION_VECTORS[direction];
  const offset = radius * 2.1;
  const half = radius * 1.3;
  const px = -dy;
  const py = dx;
  return (
    <g className="node__charger">
      <line
        x1={dx * offset + px * half}
        y1={dy * offset + py * half}
        x2={dx * offset - px * half}
        y2={dy * offset - py * half}
        strokeWidth={2.6 * mmPerPixel}
        strokeLinecap="round"
      />
      <line
        x1={dx * radius * 1.1}
        y1={dy * radius * 1.1}
        x2={dx * offset}
        y2={dy * offset}
        strokeWidth={1.8 * mmPerPixel}
      />
    </g>
  );
}

/** The conveyor, drawn as a chevron pointing the way the payload leaves. */
function ChuteGlyph({
  direction,
  radius,
  mmPerPixel,
}: {
  direction: Direction;
  radius: number;
  mmPerPixel: number;
}) {
  const { dx, dy } = SCREEN_DIRECTION_VECTORS[direction];
  const tip = radius * 3.1;
  const back = radius * 1.6;
  const px = -dy;
  const py = dx;
  const spread = radius * 1.2;
  return (
    <path
      className="node__chute"
      d={`M ${dx * back + px * spread} ${dy * back + py * spread} L ${dx * tip} ${dy * tip} L ${
        dx * back - px * spread
      } ${dy * back - py * spread}`}
      strokeWidth={2.2 * mmPerPixel}
      fill="none"
      strokeLinejoin="round"
    />
  );
}

export const NodeMarker = memo(NodeMarkerImpl);

export { DIRECTIONS };
