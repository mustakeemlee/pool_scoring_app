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

  // Regression guard for WCAG AA contrast: the lighter/mid backgrounds
  // (A/A+ green, B+/B/C+) need dark text to hit 4.5:1, the darker ones
  // (C, D) need light text. A revert of either color would silently
  // reintroduce a contrast failure with no other test to catch it.
  it.each<[Grade, string]>([
    ['A+', 'text-white'],
    ['A', 'text-black'],
    ['B+', 'text-black'],
    ['B', 'text-black'],
    ['C+', 'text-black'],
    ['C', 'text-white'],
    ['D', 'text-white'],
  ])('renders %s with %s text for WCAG AA contrast', (grade, expectedClass) => {
    render(<GradeBadge grade={grade} />);
    const badge = screen.getByText(grade);
    expect(badge.className).toContain(expectedClass);
  });
});
