import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the top nav and the leaderboard page at the root route', () => {
    render(<App />);
    expect(screen.getByText('🎱 Pool League')).toBeInTheDocument();
    expect(screen.getByText('Leaderboard — coming soon')).toBeInTheDocument();
  });
});
