import { describe, it, expect } from 'vitest';
import {
  runGate,
  GATE_PROFILES,
  type GateProfile,
  type GateCheckRunner,
} from '../src/core/gate.js';

const ok: GateCheckRunner = async () => ({ ok: true });
const fail = (detail: string): GateCheckRunner => async () => ({ ok: false, detail });

describe('runGate — evaluador del pre-flight gate (§6, §11.4)', () => {
  it('todas las reglas ok → passed true', async () => {
    const result = await runGate(GATE_PROFILES.vercel, {
      tests: ok,
      'git-clean': ok,
      'secret-scan': ok,
    });
    expect(result.passed).toBe(true);
    expect(result.results.every((r) => r.ok)).toBe(true);
  });

  it('tests rotos (regla bloqueante) → gate bloquea (passed false) [§9]', async () => {
    const result = await runGate(GATE_PROFILES.vercel, {
      tests: fail('2 tests en rojo'),
      'git-clean': ok,
      'secret-scan': ok,
    });
    expect(result.passed).toBe(false);
    expect(result.results.find((r) => r.id === 'tests')).toMatchObject({ ok: false, blocking: true });
  });

  it('secretos encontrados (regla bloqueante) → gate bloquea [§9]', async () => {
    const result = await runGate(GATE_PROFILES.vercel, {
      tests: ok,
      'git-clean': ok,
      'secret-scan': fail('secreto en .env:2'),
    });
    expect(result.passed).toBe(false);
    expect(result.results.find((r) => r.id === 'secret-scan')?.ok).toBe(false);
  });

  it('una regla NO bloqueante que falla no tumba el gate, pero queda registrada (gancho El Volante)', async () => {
    const profile: GateProfile = [{ id: 'tests', blocking: false }];
    const result = await runGate(profile, { tests: fail('flaky') });
    expect(result.passed).toBe(true);
    expect(result.results[0]).toMatchObject({ id: 'tests', ok: false, blocking: false });
  });

  it('corre las reglas en el orden del perfil, y solo esas', async () => {
    const calls: string[] = [];
    const track = (id: string): GateCheckRunner => async () => {
      calls.push(id);
      return { ok: true };
    };
    const profile: GateProfile = [
      { id: 'secret-scan', blocking: true },
      { id: 'tests', blocking: true },
    ];
    await runGate(profile, {
      'secret-scan': track('secret-scan'),
      tests: track('tests'),
      'git-clean': track('git-clean'), // presente pero NO en el perfil: no debe correr
    });
    expect(calls).toEqual(['secret-scan', 'tests']);
  });

  it('falta el runner de una regla del perfil → lanza error claro', async () => {
    await expect(runGate(GATE_PROFILES.vercel, { tests: ok, 'git-clean': ok })).rejects.toThrow(
      /secret-scan/,
    );
  });
});

describe('GATE_PROFILES — perfiles por tipo (npm el más estricto)', () => {
  it('TODAS las reglas de TODOS los perfiles son bloqueantes (El Volante no existe todavía)', () => {
    for (const [tipo, profile] of Object.entries(GATE_PROFILES)) {
      for (const rule of profile) {
        expect(rule.blocking, `${tipo}/${rule.id} debería ser blocking:true`).toBe(true);
      }
    }
  });

  it('vercel: tests + git-clean + secret-scan, todas bloqueantes', () => {
    expect(GATE_PROFILES.vercel.map((r) => r.id)).toEqual(['tests', 'git-clean', 'secret-scan']);
    expect(GATE_PROFILES.vercel.every((r) => r.blocking)).toBe(true);
  });

  it('pm2 agrega ssh-reachable', () => {
    expect(GATE_PROFILES.pm2.map((r) => r.id)).toContain('ssh-reachable');
  });

  it('npm es el más estricto: agrega version-bumped y version-not-duplicate', () => {
    const ids = GATE_PROFILES.npm.map((r) => r.id);
    expect(ids).toContain('version-bumped');
    expect(ids).toContain('version-not-duplicate');
    expect(GATE_PROFILES.npm.length).toBeGreaterThan(GATE_PROFILES.vercel.length);
  });
});
