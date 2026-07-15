import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TopNav } from './TopNav';

describe('TopNav', () => {
  it('renders links to every public page plus admin login', () => {
    render(
      <MemoryRouter>
        <TopNav />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Leaderboard' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Grades' })).toHaveAttribute('href', '/grades');
    expect(screen.getByRole('link', { name: 'Matches' })).toHaveAttribute('href', '/matches');
    expect(screen.getByRole('link', { name: 'Admin login' })).toHaveAttribute('href', '/admin/login');
  });
});
