// tests/engine-rev.test.js — the Swift and Kotlin timegrapher engines must carry the same
// `TG_ENGINE_REV: N` marker. Bump BOTH whenever engine behaviour changes on either side.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const SWIFT = 'ios/Wrotate/Wrotate/TimegrapherEngine.swift';
const KOTLIN = 'android/engine/src/main/kotlin/com/wrotate/engine/TimegrapherCore.kt';

// Recorded, deliberate divergences: { swift: N, kotlin: M, reason: '...' }. Empty = strict lockstep.
const WAIVERS = [];

const rev = (p) => {
  const m = readFileSync(join(root, p), 'utf8').match(/TG_ENGINE_REV:\s*(\d+)/);
  return m ? Number(m[1]) : null;
};

describe('engine revision lockstep', () => {
  it('both engines declare TG_ENGINE_REV', () => {
    expect(rev(SWIFT)).not.toBeNull();
    expect(rev(KOTLIN)).not.toBeNull();
  });
  it('revisions match (or the pair is waived)', () => {
    const s = rev(SWIFT), k = rev(KOTLIN);
    const waived = WAIVERS.some((w) => w.swift === s && w.kotlin === k && w.reason);
    expect(waived || s === k, `Swift rev ${s} vs Kotlin rev ${k}`).toBe(true);
  });
});
