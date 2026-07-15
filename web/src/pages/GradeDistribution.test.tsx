// web/src/pages/GradeDistribution.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/useActiveSeason', () => ({
  useActiveSeason: () => ({
    data: { id: 's1', name: 'Season 2026', start_date: '2026-01-01', end_date: null, status: 'active' },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/hooks/useGradeDistribution', () => ({
  useGradeDistribution: () => ({
    data: [
      { season_id: 's1', grade: 'A+', player_count: 2 },
      { season_id: 's1', grade: 'B', player_count: 5 },
    ],
    isLoading: false,
    isError: false,
  }),
}));

import { GradeDistributionPage } from './GradeDistribution';

function renderPage() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <GradeDistributionPage />
    </QueryClientProvider>,
  );
}

describe('GradeDistributionPage', () => {
  it('renders a row for every grade band, including zero-count ones', () => {
    renderPage();
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('D')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });
});
