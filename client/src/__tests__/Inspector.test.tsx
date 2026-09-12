import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_ORIENTATION, ORIENTATIONS, type AgvMap } from '@agv/shared';
import { Inspector } from '../components/Inspector';

const map: AgvMap = {
  maxNeighborDistance: 1500,
  nodes: [
    { x: 1000, y: 1000, code: 10001000, directions: ['North'], name: 'READY' },
    { x: 1000, y: 1800, code: 10001010, directions: ['South'] },
  ],
};

function setup(index: number | null = 0, overrides: Partial<AgvMap> = {}) {
  const handlers = {
    onUpdate: vi.fn(),
    onToggleDirection: vi.fn(),
    onSetFeature: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <Inspector
      map={{ ...map, ...overrides }}
      orientation={DEFAULT_ORIENTATION}
      index={index}
      issues={[]}
      {...handlers}
    />,
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('with nothing selected', () => {
  it('invites the user to pick a node instead of showing an empty form', () => {
    setup(null);
    expect(screen.getByText(/pick a node/i)).toBeInTheDocument();
    expect(screen.queryByTestId('inspector')).not.toBeInTheDocument();
  });
});

describe('with a node selected', () => {
  it('shows the node name as the heading and its current values', () => {
    setup(0);
    expect(screen.getByRole('heading', { name: 'READY' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^x/)).toHaveValue('1000');
    expect(screen.getByLabelText(/QR code/)).toHaveValue('10001000');
  });

  it('falls back to the code when the node has no name', () => {
    setup(1);
    expect(screen.getByRole('heading', { name: /Node 10001010/ })).toBeInTheDocument();
  });

  it('marks the active headings and leaves the rest off', () => {
    setup(0);
    expect(screen.getByRole('switch', { name: 'North' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: 'South' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('toggles a heading on click', async () => {
    const { user, onToggleDirection } = setup(0);
    await user.click(screen.getByRole('switch', { name: 'East' }));
    expect(onToggleDirection).toHaveBeenCalledWith(0, 'East');
  });
});

describe('coordinate editing', () => {
  /**
   * The important behaviour: a numeric field must not commit mid-typing. Every
   * intermediate value is a legal position, so committing per keystroke would
   * walk the node across the floor and rebuild the lane graph as you type.
   */
  it('does not commit while typing', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText(/^x/);
    await user.clear(field);
    await user.type(field, '2500');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('commits the parsed value on Enter', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText(/^x/);
    await user.clear(field);
    await user.type(field, '2500{Enter}');
    expect(onUpdate).toHaveBeenCalledWith(0, { x: 2500 });
  });

  it('commits on blur', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText(/^y/);
    await user.clear(field);
    await user.type(field, '4110');
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith(0, { y: 4110 });
  });

  it('rounds a fractional entry to whole millimetres', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText(/^x/);
    await user.clear(field);
    await user.type(field, '1000.7{Enter}');
    expect(onUpdate).toHaveBeenCalledWith(0, { x: 1001 });
  });

  it('restores the real value when the entry is not a number', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText(/^x/);
    await user.clear(field);
    await user.type(field, 'left a bit{Enter}');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(field).toHaveValue('1000');
  });

  it('reverts the draft on Escape', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText(/^x/);
    await user.clear(field);
    await user.type(field, '9999{Escape}');
    expect(field).toHaveValue('1000');
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('name editing', () => {
  it('commits a new name on blur', async () => {
    const { user, onUpdate } = setup(1);
    const field = screen.getByLabelText('Name');
    await user.type(field, 'STAGING');
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith(1, { name: 'STAGING' });
  });

  it('sends an empty string when the name is cleared, which removes the key', async () => {
    const { user, onUpdate } = setup(0);
    const field = screen.getByLabelText('Name');
    await user.clear(field);
    await user.tab();
    expect(onUpdate).toHaveBeenCalledWith(0, { name: '' });
  });
});

describe('charger and chute', () => {
  it('sets a charger direction', async () => {
    const { user, onSetFeature } = setup(0);
    await user.selectOptions(screen.getByLabelText('Charger'), 'West');
    expect(onSetFeature).toHaveBeenCalledWith(0, 'charger', 'West');
  });

  it('clears a feature back to none', async () => {
    const { user, onSetFeature } = setup(0, {
      nodes: [{ ...map.nodes[0], chute: { direction: 'North' } }, map.nodes[1]],
    });
    await user.selectOptions(screen.getByLabelText('Chute'), '');
    expect(onSetFeature).toHaveBeenCalledWith(0, 'chute', null);
  });
});

describe('dangling headings', () => {
  it('flags a heading that leads nowhere, using the active compass', () => {
    // Node 0's only neighbour is North, so East is enabled but dangling.
    render(
      <Inspector
        map={{
          maxNeighborDistance: 1500,
          nodes: [
            { x: 1000, y: 1000, code: 1, directions: ['North', 'East'] },
            { x: 1000, y: 1800, code: 2, directions: ['South'] },
          ],
        }}
        orientation={ORIENTATIONS.mapData}
        index={0}
        issues={[]}
        onUpdate={vi.fn()}
        onToggleDirection={vi.fn()}
        onSetFeature={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch', { name: 'East' }).className).toContain('chip--dangling');
    expect(screen.getByRole('switch', { name: 'North' }).className).not.toContain(
      'chip--dangling',
    );
  });
});

describe('node issues', () => {
  it('lists issues attached to the selected node only', () => {
    render(
      <Inspector
        map={map}
        orientation={DEFAULT_ORIENTATION}
        index={0}
        issues={[
          { code: 'W014', severity: 'warning', message: 'Points nowhere.', nodeIndex: 0 },
          { code: 'W012', severity: 'warning', message: 'Someone else’s problem.', nodeIndex: 1 },
        ]}
        onUpdate={vi.fn()}
        onToggleDirection={vi.fn()}
        onSetFeature={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText('Points nowhere.')).toBeInTheDocument();
    expect(screen.queryByText('Someone else’s problem.')).not.toBeInTheDocument();
  });
});

describe('deleting', () => {
  it('asks the parent to delete the selected node', async () => {
    const { user, onDelete } = setup(1);
    await user.click(screen.getByRole('button', { name: /delete this node/i }));
    expect(onDelete).toHaveBeenCalledWith(1);
  });
});
