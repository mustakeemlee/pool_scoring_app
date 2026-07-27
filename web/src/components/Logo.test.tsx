import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

describe('Logo', () => {
  it('renders the logo image at the given size', () => {
    const { container } = render(<Logo size={32} />);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('src', '/logo.png');
    expect(img).toHaveStyle({ height: '32px' });
  });
});
