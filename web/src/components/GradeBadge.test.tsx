import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GradeBadge } from './GradeBadge';
import type { Grade } from '@/lib/types';

describe('GradeBadge', () => {
  it.each<[Grade, string]>([
    ['A+', 'bg-green-700'],
    ['A', 'bg-green-600'],
    ['B+', 'bg-lime-600'],
    ['B', 'bg-yellow-500'],
    ['C+', 'bg-orange-500'],
    ['C', 'bg-orange-700'],
    ['D', 'bg-red-700'],
  ])('renders %s with the %s background class', (grade, expectedClass) => {
    render(<GradeBadge grade={grade} />);
    const badge = screen.getByText(grade);
    expect(badge.className).toContain(expectedClass);
  });
});
