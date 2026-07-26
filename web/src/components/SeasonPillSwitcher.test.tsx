import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeasonPillSwitcher } from './SeasonPillSwitcher';

const SEASONS = [
  { id: 's2', name: 'Season 2026', start_date: '2026-06-01', end_date: null, status: 'active' as const },
  { id: 's1', name: 'Season 2025', start_date: '2025-01-01', end_date: '2025-12-31', status: 'completed' as const },
];

describe('SeasonPillSwitcher', () => {
  it('renders nothing when there is no selected season', () => {
    const { container } = render(
      <SeasonPillSwitcher
        selectedSeason={null}
        seasons={[]}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the season name and an Active badge when the selected season is active', () => {
    render(
      <SeasonPillSwitcher
        selectedSeason={SEASONS[0]}
        seasons={SEASONS}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious
        hasNext={false}
      />,
    );
    expect(screen.getByText('Season 2026')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('does not show the Active badge for a completed season', () => {
    render(
      <SeasonPillSwitcher
        selectedSeason={SEASONS[1]}
        seasons={SEASONS}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        hasPrevious={false}
        hasNext
      />,
    );
    expect(screen.getByText('Season 2025')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('disables the previous button when hasPrevious is false, and calls onNext when the next button is clicked', async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <SeasonPillSwitcher
        selectedSeason={SEASONS[1]}
        seasons={SEASONS}
        onSelectSeason={vi.fn()}
        onPrevious={vi.fn()}
        onNext={onNext}
        hasPrevious={false}
        hasNext
      />,
    );
    expect(screen.getByRole('button', { name: 'Previous season' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Next season' }));
    expect(onNext).toHaveBeenCalled();
  });
});
