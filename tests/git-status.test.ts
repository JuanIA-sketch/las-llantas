import { describe, it, expect } from 'vitest';
import { gitCleanCheck, type GitStatusDeps } from '../src/preflight/git-status.js';

const runGit = (code: number, stdout: string): GitStatusDeps => ({
  runGit: async () => ({ code, stdout }),
});

describe('gitCleanCheck — working tree limpio para el gate (§6)', () => {
  it('porcelain vacío → limpio → ok', async () => {
    const r = await gitCleanCheck('/proj', runGit(0, ''));
    expect(r.ok).toBe(true);
  });

  it('porcelain con cambios → sucio → not ok con la cantidad de archivos', async () => {
    const r = await gitCleanCheck('/proj', runGit(0, ' M src/a.ts\n?? src/b.ts\n'));
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/2/); // 2 archivos con cambios
  });

  it('git falla (no es repo) → not ok con detalle claro, sin adivinar', async () => {
    const r = await gitCleanCheck('/proj', runGit(128, ''));
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it('corre `git status --porcelain`', async () => {
    let args: string[] = [];
    await gitCleanCheck('/proj', { runGit: async (_cwd, a) => { args = a; return { code: 0, stdout: '' }; } });
    expect(args).toEqual(['status', '--porcelain']);
  });
});
