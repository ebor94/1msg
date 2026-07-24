import { describe, it, expect } from 'vitest';
import { iniciales } from './formato';

describe('formato', () => {
  it('iniciales toma hasta 2 palabras', () => {
    expect(iniciales('Carlos Rincón')).toBe('CR');
    expect(iniciales('María')).toBe('M');
    expect(iniciales('')).toBe('?');
  });
});
