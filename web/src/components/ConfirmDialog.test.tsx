// web/src/components/ConfirmDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  it('shows the title/description only after the trigger is clicked, then calls onConfirm', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        trigger={<button type="button">Open</button>}
        title="Close the week ending 2026-01-22?"
        description="This locks 14 match(es) and runs Glicko-2 reconciliation for 8 player(s). This cannot be undone."
        confirmLabel="Confirm Close Week"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.queryByText('Close the week ending 2026-01-22?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getByText('Close the week ending 2026-01-22?')).toBeInTheDocument();
    expect(
      screen.getByText('This locks 14 match(es) and runs Glicko-2 reconciliation for 8 player(s). This cannot be undone.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm Close Week' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('does not call onConfirm when Cancel is clicked', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    render(
      <ConfirmDialog
        trigger={<button type="button">Open</button>}
        title="Title"
        description="Description"
        confirmLabel="Confirm"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
