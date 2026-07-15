// web/src/components/RatingChart.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RatingChart } from './RatingChart';

describe('RatingChart', () => {
  it('renders the chart container when points are provided', () => {
    render(<RatingChart points={[{ date: '2026-01-08', rating: 1514 }]} />);
    expect(screen.getByTestId('rating-chart')).toBeInTheDocument();
  });

  it('renders an empty state when there are no points', () => {
    render(<RatingChart points={[]} />);
    expect(screen.getByText('No rating history yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('rating-chart')).not.toBeInTheDocument();
  });
});
