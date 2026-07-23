/**
 * Runner de gate: confirma que el working tree está limpio (§6, "git status
 * limpio"). Usa `git status --porcelain`: salida vacía = limpio. Nunca reporta el
 * contenido de los cambios, solo cuántos archivos. El I/O de git se inyecta.
 */

import type { GateCheckOutcome } from '../core/gate.js';

export interface GitStatusDeps {
  runGit: (cwd: string, args: string[]) => Promise<{ code: number; stdout: string }>;
}

export async function gitCleanCheck(cwd: string, deps: GitStatusDeps): Promise<GateCheckOutcome> {
  const { code, stdout } = await deps.runGit(cwd, ['status', '--porcelain']);

  if (code !== 0) {
    return { ok: false, detail: 'no pude verificar git status (¿esta carpeta es un repo git?)' };
  }

  const changed = stdout.split('\n').filter((line) => line.trim() !== '');
  if (changed.length === 0) return { ok: true };

  return { ok: false, detail: `${changed.length} archivo(s) con cambios sin commitear` };
}
