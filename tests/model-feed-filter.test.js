import { describe, it, expect } from 'vitest';
import { modelFeedLabel } from '../wrotate_test.js';

// The "Posts with <model>" banner label for the model-filtered feed
// (model page → "N photos"). Mirrored verbatim in index.html.
describe('modelFeedLabel', () => {
  it('joins brand and name', () => {
    expect(modelFeedLabel('Rolex', 'Datejust')).toBe('Rolex Datejust');
  });
  it('falls back to whichever half exists', () => {
    expect(modelFeedLabel('Rolex', '')).toBe('Rolex');
    expect(modelFeedLabel(null, 'Datejust')).toBe('Datejust');
  });
  it('never renders an empty banner', () => {
    expect(modelFeedLabel('', null)).toBe('this watch');
    expect(modelFeedLabel(undefined, undefined)).toBe('this watch');
  });
});
