// web/src/components/OddsWidget.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OddsWidget } from './OddsWidget';

describe('OddsWidget', () => {
  it('shows a 50/50 split for equal ratings', () => {
    render(<OddsWidget playerARating={1500} playerBRating={1500} playerAName="Alex" playerBName="Jordan" />);
    const percentages = screen.getAllByText('50%');
    expect(percentages).toHaveLength(2);
  });

  it('shows the rating-favored player with a higher percentage', () => {
    // 200-point gap: winProbability(1600, 1400) = 1 / (1 + 10^(-200/400)) ≈ 0.7597
    render(<OddsWidget playerARating={1600} playerBRating={1400} playerAName="Alex" playerBName="Jordan" />);
    expect(screen.getByText('76%')).toBeInTheDocument();
    expect(screen.getByText('24%')).toBeInTheDocument();
  });

  it('never renders decimal odds, only percentages', () => {
    render(<OddsWidget playerARating={1600} playerBRating={1400} playerAName="Alex" playerBName="Jordan" />);
    expect(screen.queryByText(/[0-9]\.[0-9]+x/)).not.toBeInTheDocument();
  });
});
