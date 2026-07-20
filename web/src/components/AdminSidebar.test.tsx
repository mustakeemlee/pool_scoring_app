import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

describe('AdminSidebar', () => {
  it('renders the 5 admin action links and no logout button', () => {
    render(
      <MemoryRouter>
        <AdminSidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Enter Match' })).toHaveAttribute('href', '/admin/enter-match');
    expect(screen.getByRole('link', { name: 'Correct a Match' })).toHaveAttribute('href', '/admin/correct-match');
    expect(screen.getByRole('link', { name: 'Close Week' })).toHaveAttribute('href', '/admin/close-week');
    expect(screen.getByRole('link', { name: 'Start Season' })).toHaveAttribute('href', '/admin/start-season');
    expect(screen.getByRole('link', { name: 'Players' })).toHaveAttribute('href', '/admin/players');
    expect(screen.queryByRole('button', { name: /logout/i })).not.toBeInTheDocument();
  });
});
