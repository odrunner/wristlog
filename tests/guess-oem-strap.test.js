import { describe, it, expect } from 'vitest';
import { guessOEMStrap } from '../wristlog.js';

describe('guessOEMStrap', () => {
  // ── Specific ref matches ─────────────────────────────────────────────────

  it('matches AP pink gold bracelet by ref', () => {
    const result = guessOEMStrap({ brand: 'AP', name: 'Royal Oak', ref: '77451OR.ZZ.1361OR.01' });
    expect(result.material).toBe('18K Pink Gold');
  });

  it('matches AP steel bracelet by ref', () => {
    const result = guessOEMStrap({ brand: 'AP', name: 'Royal Oak', ref: '26715ST.OO.1356ST.01' });
    expect(result.material).toBe('Steel');
  });

  it('matches Blancpain rubber by ref', () => {
    const result = guessOEMStrap({ brand: 'Blancpain', name: 'Fifty Fathoms', ref: '5010-12B64-NABA' });
    expect(result.material).toBe('Rubber');
  });

  it('matches Kurono jubilee leather strap', () => {
    const result = guessOEMStrap({ brand: 'Kurono Tokyo', name: 'Grand Jubilee', ref: '' });
    expect(result.material).toBe('Calf Leather');
  });

  // ── Brand + model keyword fallbacks ──────────────────────────────────────

  it('returns rubber for AP Royal Oak Offshore', () => {
    const result = guessOEMStrap({ brand: 'Audemars Piguet', name: 'Royal Oak Offshore', ref: '' });
    expect(result).toEqual({ name: 'Rubber Strap', material: 'Rubber' });
  });

  it('returns steel bracelet for AP Royal Oak', () => {
    const result = guessOEMStrap({ brand: 'Audemars Piguet', name: 'Royal Oak', ref: '' });
    expect(result).toEqual({ name: 'Integrated Steel Bracelet', material: 'Steel' });
  });

  it('returns Oyster Bracelet for generic Rolex', () => {
    const result = guessOEMStrap({ brand: 'Rolex', name: 'Submariner', ref: '' });
    expect(result).toEqual({ name: 'Oyster Bracelet', material: 'Steel' });
  });

  it('returns leather for Rolex Cellini', () => {
    const result = guessOEMStrap({ brand: 'Rolex', name: 'Cellini Moonphase', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns metal bracelet for generic Omega', () => {
    const result = guessOEMStrap({ brand: 'Omega', name: 'Seamaster', ref: '' });
    expect(result).toEqual({ name: 'Metal Bracelet', material: 'Steel' });
  });

  it('returns leather for Omega De Ville', () => {
    const result = guessOEMStrap({ brand: 'Omega', name: 'De Ville Prestige', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns fabric for Tudor Black Bay', () => {
    const result = guessOEMStrap({ brand: 'Tudor', name: 'Black Bay 58', ref: '' });
    expect(result).toEqual({ name: 'Fabric Strap', material: 'Fabric' });
  });

  it('returns steel for generic Tudor', () => {
    const result = guessOEMStrap({ brand: 'Tudor', name: 'Royal', ref: '' });
    expect(result).toEqual({ name: 'Steel Bracelet', material: 'Steel' });
  });

  it('returns rubber for Tag Heuer', () => {
    const result = guessOEMStrap({ brand: 'Tag Heuer', name: 'Aquaracer', ref: '' });
    expect(result.material).toBe('Rubber');
  });

  it('returns rubber for Patek Aquanaut', () => {
    const result = guessOEMStrap({ brand: 'Patek Philippe', name: 'Aquanaut', ref: '' });
    expect(result.material).toBe('Rubber');
  });

  it('returns leather for generic Patek', () => {
    const result = guessOEMStrap({ brand: 'Patek Philippe', name: 'Calatrava', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns leather for Cartier', () => {
    const result = guessOEMStrap({ brand: 'Cartier', name: 'Santos', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns leather for JLC', () => {
    const result = guessOEMStrap({ brand: 'Jaeger-LeCoultre', name: 'Reverso', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns rubber for IWC Aquatimer', () => {
    const result = guessOEMStrap({ brand: 'IWC', name: 'Aquatimer', ref: '' });
    expect(result.material).toBe('Rubber');
  });

  it('returns leather for generic IWC', () => {
    const result = guessOEMStrap({ brand: 'IWC', name: 'Portugieser', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns leather for Panerai', () => {
    const result = guessOEMStrap({ brand: 'Panerai', name: 'Luminor', ref: '' });
    expect(result.material).toBe('Leather');
  });

  it('returns leather for Seiko', () => {
    const result = guessOEMStrap({ brand: 'Seiko', name: 'Presage', ref: '' });
    expect(result.material).toBe('Leather');
  });

  // ── Generic name-keyword fallback ────────────────────────────────────────

  it('returns rubber for unknown diver brand', () => {
    const result = guessOEMStrap({ brand: 'Microbrand', name: 'Ocean Diver 300', ref: '' });
    expect(result.material).toBe('Rubber');
  });

  it('returns leather for unknown pilot brand', () => {
    const result = guessOEMStrap({ brand: 'Microbrand', name: 'Pilot Watch', ref: '' });
    expect(result.material).toBe('Leather');
  });

  // ── Null fallback ────────────────────────────────────────────────────────

  it('returns null for completely unknown watch', () => {
    const result = guessOEMStrap({ brand: 'NoName', name: 'Mystery', ref: '' });
    expect(result).toBeNull();
  });

  it('handles missing fields gracefully', () => {
    const result = guessOEMStrap({});
    expect(result).toBeNull();
  });
});
