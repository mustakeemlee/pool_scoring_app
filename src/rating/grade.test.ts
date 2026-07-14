import { describe, it, expect } from 'vitest';
import { gradeForRating } from './grade';

describe('gradeForRating', () => {
  it('returns A+ at and above 2000', () => {
    expect(gradeForRating(2000)).toBe('A+');
    expect(gradeForRating(2500)).toBe('A+');
  });

  it('returns A from 1800 up to (not including) 2000', () => {
    expect(gradeForRating(1800)).toBe('A');
    expect(gradeForRating(1999.99)).toBe('A');
  });

  it('returns B+ from 1600 up to (not including) 1800', () => {
    expect(gradeForRating(1600)).toBe('B+');
    expect(gradeForRating(1799.99)).toBe('B+');
  });

  it('returns B from 1400 up to (not including) 1600', () => {
    expect(gradeForRating(1400)).toBe('B');
    expect(gradeForRating(1599.99)).toBe('B');
  });

  it('returns C+ from 1200 up to (not including) 1400', () => {
    expect(gradeForRating(1200)).toBe('C+');
    expect(gradeForRating(1399.99)).toBe('C+');
  });

  it('returns C from 1000 up to (not including) 1200', () => {
    expect(gradeForRating(1000)).toBe('C');
    expect(gradeForRating(1199.99)).toBe('C');
  });

  it('returns D below 1000', () => {
    expect(gradeForRating(999.99)).toBe('D');
    expect(gradeForRating(0)).toBe('D');
  });
});
