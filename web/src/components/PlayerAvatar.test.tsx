// web/src/components/PlayerAvatar.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerAvatar } from './PlayerAvatar';

describe('PlayerAvatar', () => {
  it('renders the photo when a photoUrl is given', () => {
    render(<PlayerAvatar name="Alex Testplayer" photoUrl="https://example.com/p.jpg" />);
    const img = screen.getByRole('img', { name: 'Alex Testplayer' });
    expect(img).toHaveAttribute('src', 'https://example.com/p.jpg');
  });

  it('shows a grey placeholder icon, not initials, when there is no photo', () => {
    const { container } = render(<PlayerAvatar name="Alex Testplayer" photoUrl={null} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('AT')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back to the placeholder icon if the photo fails to load', () => {
    render(<PlayerAvatar name="Alex Testplayer" photoUrl="https://example.com/broken.jpg" />);
    fireEvent.error(screen.getByRole('img', { name: 'Alex Testplayer' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
