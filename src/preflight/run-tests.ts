/**
 * Runner de gate: corre los tests del proyecto (§6, "tests en verde"). Detecta el
 * script `test` del package.json y, si existe, corre `npm test`. Sin script de test
 * no bloquea (no hay nada que correr) — lo deja anotado, sin maquillar.
 * El I/O (leer package.json, correr el comando) se inyecta.
 */

import type { GateCheckOutcome } from '../core/gate.js';

export interface RunTestsDeps {
  readPackageJson: (cwd: string) => Promise<{ scripts?: Record<string, unknown> } | null>;
  runCommand: (cwd: string, command: string, args: string[]) => Promise<{ code: number }>;
}

function hasTestScript(pkg: { scripts?: Record<string, unknown> } | null): boolean {
  const test = pkg?.scripts?.test;
  return typeof test === 'string' && test.trim() !== '';
}

export async function runTestsCheck(cwd: string, deps: RunTestsDeps): Promise<GateCheckOutcome> {
  const pkg = await deps.readPackageJson(cwd);
  if (!hasTestScript(pkg)) {
    return { ok: true, detail: 'no hay script de test en package.json (se omite)' };
  }

  const { code } = await deps.runCommand(cwd, 'npm', ['test']);
  return code === 0
    ? { ok: true }
    : { ok: false, detail: 'los tests fallaron (npm test salió con error)' };
}
