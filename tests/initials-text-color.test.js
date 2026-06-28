import { describe, it, expect } from 'vitest';
import { initialsTextColor } from '../wrotate_test.js';

describe('initialsTextColor', () => {
  it('picks black text on light backgrounds', () => {
    expect(initialsTextColor('#c9a84c')).toBe('#000'); // gold
    expect(initialsTextColor('#ffffff')).toBe('#000'); // white
    expect(initialsTextColor('#f5f5f8')).toBe('#000'); // near-white
    expect(initialsTextColor('#e0d090')).toBe('#000'); // pale gold
  });

  it('picks white text on dark backgrounds', () => {
    expect(initialsTextColor('#000000')).toBe('#fff'); // black dial
    expect(initialsTextColor('#1a2a4a')).toBe('#fff'); // navy dial
    expect(initialsTextColor('#1b3a1b')).toBe('#fff'); // dark green dial
    expect(initialsTextColor('#5a2d2d')).toBe('#fff'); // dark oxblood
  });

  it('supports 3-digit hex', () => {
    expect(initialsTextColor('#fff')).toBe('#000');
    expect(initialsTextColor('#000')).toBe('#fff');
  });

  it('tolerates a leading-# omission and whitespace', () => {
    expect(initialsTextColor('c9a84c')).toBe('#000');
    expect(initialsTextColor('  #1a2a4a  ')).toBe('#fff');
  });

  it('defaults to black for invalid/empty input', () => {
    expect(initialsTextColor('')).toBe('#000');
    expect(initialsTextColor(null)).toBe('#000');
    expect(initialsTextColor('not-a-color')).toBe('#000');
    expect(initialsTextColor('#12')).toBe('#000');
  });
});
