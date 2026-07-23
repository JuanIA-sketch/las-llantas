/**
 * Pre-flight gate (§6). Las reglas viven en un OBJETO de configuración (perfiles
 * por tipo), no en condicionales sueltos — así El Volante (§11.4) podrá más
 * adelante ajustar qué reglas son bloqueantes por modo (Eco/Confort/Sport) sin
 * reescribir Las Llantas. Este módulo solo orquesta: cada check real (correr
 * tests, git status, secret-scan, ssh, versión) se inyecta como runner.
 */

import type { ProjectType } from './detect.js';

export type GateRuleId =
  | 'tests'
  | 'git-clean'
  | 'secret-scan'
  | 'ssh-reachable'
  | 'version-bumped'
  | 'version-not-duplicate';

export interface GateRule {
  id: GateRuleId;
  /** Si true y el check falla, el gate no pasa. Si false, se registra pero no bloquea. */
  blocking: boolean;
}

export type GateProfile = GateRule[];

/** Resultado de un check individual (lo devuelve el runner inyectado). */
export interface GateCheckOutcome {
  ok: boolean;
  /** Detalle legible para el reporte (p.ej. "2 tests en rojo"). Nunca un secreto crudo. */
  detail?: string;
}

export type GateCheckRunner = () => Promise<GateCheckOutcome>;

export interface GateRuleResult {
  id: GateRuleId;
  ok: boolean;
  blocking: boolean;
  detail?: string;
}

export interface GateResult {
  /** true si ninguna regla BLOQUEANTE falló. */
  passed: boolean;
  results: GateRuleResult[];
}

/** Perfiles por defecto por tipo. npm es el más estricto: no hay vuelta atrás. */
export const GATE_PROFILES: Record<ProjectType, GateProfile> = {
  vercel: [
    { id: 'tests', blocking: true },
    { id: 'git-clean', blocking: true },
    { id: 'secret-scan', blocking: true },
  ],
  pm2: [
    { id: 'tests', blocking: true },
    { id: 'git-clean', blocking: true },
    { id: 'secret-scan', blocking: true },
    { id: 'ssh-reachable', blocking: true },
  ],
  npm: [
    { id: 'tests', blocking: true },
    { id: 'git-clean', blocking: true },
    { id: 'secret-scan', blocking: true },
    { id: 'version-bumped', blocking: true },
    { id: 'version-not-duplicate', blocking: true },
  ],
};

/**
 * Corre todas las reglas del perfil, en orden, con el runner inyectado de cada una.
 * Corre TODAS (no fail-fast) para reportar de una todo lo que está mal, igual que
 * el aggregator de La Alarma. `passed` es false solo si falló una regla bloqueante.
 * Un runner ausente para una regla del perfil es un error de configuración → lanza.
 */
export async function runGate(
  profile: GateProfile,
  runners: Partial<Record<GateRuleId, GateCheckRunner>>,
): Promise<GateResult> {
  const results: GateRuleResult[] = [];
  for (const rule of profile) {
    const runner = runners[rule.id];
    if (!runner) {
      throw new Error(`Falta el runner para la regla de gate "${rule.id}".`);
    }
    const outcome = await runner();
    results.push({ id: rule.id, ok: outcome.ok, blocking: rule.blocking, detail: outcome.detail });
  }
  const passed = results.every((r) => r.ok || !r.blocking);
  return { passed, results };
}

/** Desglose legible del gate: una línea por regla con su estado y detalle. Función pura. */
export function formatGateResults(gate: GateResult): string {
  return gate.results
    .map((r) => `   ${r.ok ? '🟢' : '🔴'} ${r.id}${r.detail ? ` — ${r.detail}` : ''}`)
    .join('\n');
}
