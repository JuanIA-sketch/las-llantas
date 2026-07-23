// VENDORIZADO de La Alarma — copiado de la-alarma@0.1.1 `tests/secret-patterns.test.ts`.
// Guardia de regresión del detector copiado: si alguien edita src/core/secret-patterns.ts,
// este test lo mantiene honesto.
import { describe, it, expect } from 'vitest';
import { detectSecrets } from '../src/core/secret-patterns.js';
import { SYNTHETIC_SECRETS as SAMPLES } from './support/synthetic-secrets.js';

describe('detectSecrets (vendorizado de La Alarma)', () => {
  it('detecta cada forma de secreto sintético con su ruleId', () => {
    for (const [ruleId, value] of Object.entries(SAMPLES)) {
      const matches = detectSecrets(value);
      const ids = matches.map((m) => m.ruleId);
      expect(ids, `esperaba ${ruleId} en "${value}"`).toContain(ruleId);
    }
  });

  it('no marca strings limpios', () => {
    const clean = [
      'hello world',
      'https://example.com/api',
      '={{ $json.email }}',
      'un valor normal sin secretos',
      '',
    ];
    for (const value of clean) {
      expect(detectSecrets(value), `no debería marcar "${value}"`).toHaveLength(0);
    }
  });

  it('el PatternMatch nunca contiene el valor del secreto', () => {
    const value = SAMPLES['github-pat'];
    const matches = detectSecrets(value);
    const serialized = JSON.stringify(matches);
    expect(serialized).not.toContain(value);
  });

  it('cada match trae ruleId y description no vacíos', () => {
    const matches = detectSecrets(SAMPLES['private-key']);
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.ruleId).toBeTruthy();
      expect(m.description).toBeTruthy();
    }
  });
});
