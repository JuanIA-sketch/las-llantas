import { describe, it, expect } from 'vitest';
import { createPm2Deployer, type Pm2DeployerDeps } from '../src/deployers/pm2.js';

const noSleep = async () => {};
const online = [{ name: 'demo', pm2_env: { status: 'online' } }];

/** runRemote falso: responde según el comando (rev-parse / pm2 jlist / secuencia). */
function fakeRemote(opts: { seqCode?: number; commit?: string; jlist?: unknown[] } = {}) {
  const commands: string[] = [];
  const run = async (cmd: string) => {
    commands.push(cmd);
    if (cmd.includes('rev-parse')) return { code: 0, stdout: `${opts.commit ?? 'a1b2c3d4e5f6'}\n` };
    if (cmd.includes('pm2 jlist')) return { code: 0, stdout: JSON.stringify(opts.jlist ?? []) };
    return { code: opts.seqCode ?? 0, stdout: '' };
  };
  return { commands, run };
}

function deps(over: Partial<Pm2DeployerDeps> = {}, remote = fakeRemote()): Pm2DeployerDeps {
  return {
    runRemote: remote.run,
    httpGet: async () => ({ status: 200 }),
    remoteDir: '/var/www/demo',
    processName: 'demo',
    branch: 'main',
    healthUrl: 'https://demo.example.com/salud',
    retry: { attempts: 2, delayMs: 1, sleep: noSleep },
    ...over,
  };
}

/**
 * runRemote falso que MODELA el estado de git: un `checkout <sha>` deja detached
 * HEAD; un `checkout <rama>` vuelve a la rama; `git pull --ff-only` falla si está
 * detached. Corre cada sub-comando del `&&` en orden. Sirve para probar que el
 * rollback no rompe el próximo deploy.
 */
function gitStateRemote(opts: { commit?: string; jlist?: unknown[] } = {}) {
  const state = { detached: false };
  const commands: string[] = [];
  const run = async (cmd: string) => {
    commands.push(cmd);
    if (cmd.includes('pm2 jlist')) return { code: 0, stdout: JSON.stringify(opts.jlist ?? []) };
    for (const part of cmd.split('&&').map((p) => p.trim())) {
      if (part.startsWith('git checkout ')) {
        const target = part.slice('git checkout '.length).trim();
        state.detached = /^[0-9a-fA-F]{7,40}$/.test(target); // checkout de un SHA suelto → detached
      } else if (part.startsWith('git pull')) {
        if (state.detached) return { code: 1, stdout: 'fatal: not on a branch' };
      } else if (part.includes('rev-parse')) {
        return { code: 0, stdout: `${opts.commit ?? 'a1b2c3d4e5f6'}\n` };
      }
    }
    return { code: 0, stdout: '' };
  };
  return { state, commands, run };
}

describe('pm2 deployer — deploy (§6)', () => {
  it('corre la secuencia (git pull → npm install → pm2 restart) y captura el commit', async () => {
    const remote = fakeRemote({ commit: 'a1b2c3d4e5f6' });
    const d = createPm2Deployer(deps({}, remote));
    const r = await d.deploy();

    expect(r).toMatchObject({ ok: true, commit: 'a1b2c3d4e5f6' });
    const seq = remote.commands.find((c) => c.includes('git pull'))!;
    expect(seq).toContain('git pull');
    expect(seq).toContain('npm install');
    expect(seq).toContain('pm2 restart demo');
  });

  it('incluye npm run build cuando hasBuild', async () => {
    const remote = fakeRemote();
    const d = createPm2Deployer(deps({ hasBuild: true }, remote));
    await d.deploy();
    expect(remote.commands.find((c) => c.includes('git pull'))).toContain('npm run build');
  });

  it('la secuencia falla (code≠0) → deploy no ok, no intenta leer el commit', async () => {
    const remote = fakeRemote({ seqCode: 1 });
    const d = createPm2Deployer(deps({}, remote));
    const r = await d.deploy();
    expect(r.ok).toBe(false);
    expect(remote.commands.some((c) => c.includes('rev-parse'))).toBe(false);
  });

  it('seguridad: processName con comilla simple → deploy lanza (no se interpola en el comando remoto)', async () => {
    const d = createPm2Deployer(deps({ processName: "de'mo" }));
    await expect(d.deploy()).rejects.toThrow(/proceso/i);
  });
});

describe('pm2 deployer — verify (§6)', () => {
  it('/salud responde 200 → ok, verificación FUERTE (no weak)', async () => {
    const d = createPm2Deployer(deps({ httpGet: async () => ({ status: 200 }) }));
    const r = await d.verify({ ok: true });
    expect(r.ok).toBe(true);
    expect(r.weak).toBeFalsy();
  });

  it('/salud 503 tras reintentos → not ok', async () => {
    const d = createPm2Deployer(deps({ httpGet: async () => ({ status: 503 }) }));
    const r = await d.verify({ ok: true });
    expect(r.ok).toBe(false);
  });

  it('sin /salud → fallback de estado PM2 online, marcado weak:true (no distingue vivo de vivo-pero-roto)', async () => {
    const remote = fakeRemote({ jlist: online });
    const d = createPm2Deployer(deps({ healthUrl: undefined }, remote));
    const r = await d.verify({ ok: true });
    expect(r.ok).toBe(true);
    expect(r.weak).toBe(true);
    expect(r.detail).toBeTruthy();
  });

  it('sin /salud → NUNCA hace un GET HTTP (no adivina una URL del sshTarget), va directo al fallback PM2', async () => {
    let httpCalls = 0;
    const remote = fakeRemote({ jlist: online });
    const d = createPm2Deployer(
      deps({ healthUrl: undefined, httpGet: async () => { httpCalls++; return { status: 200 }; } }, remote),
    );
    const r = await d.verify({ ok: true });
    expect(httpCalls).toBe(0); // no intentó ninguna URL HTTP
    expect(r.ok).toBe(true); // usó el estado PM2
    expect(remote.commands.some((c) => c.includes('pm2 jlist'))).toBe(true);
  });

  it('fallback: proceso no online (errored) → not ok', async () => {
    const remote = fakeRemote({ jlist: [{ name: 'demo', pm2_env: { status: 'errored' } }] });
    const d = createPm2Deployer(deps({ healthUrl: undefined }, remote));
    expect((await d.verify({ ok: true })).ok).toBe(false);
  });
});

describe('pm2 deployer — rollback vía lastGoodCommit (§6, §9)', () => {
  it('primer deploy (sin lastGoodCommit) → no intenta, reporta claro [§9]', async () => {
    const d = createPm2Deployer(deps({ lastGoodCommit: undefined }));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: false, ok: false });
    expect(r.detail).toMatch(/primer deploy|último|no hay/i);
  });

  it('con lastGoodCommit → vuelve a la rama + reset --hard al commit + reinstala + reinicia + RE-verifica → ok true', async () => {
    const remote = fakeRemote();
    const d = createPm2Deployer(deps({ lastGoodCommit: 'a1b2c3d4', httpGet: async () => ({ status: 200 }) }, remote));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: true, ok: true });
    const seq = remote.commands.find((c) => c.includes('git reset'))!;
    expect(seq).toContain('git checkout main');       // vuelve a la rama, no a un SHA suelto
    expect(seq).toContain('git reset --hard a1b2c3d4'); // y la resetea al commit bueno
  });

  it('después de un rollback, un deploy normal SÍ funciona (vuelve a la rama, no detached HEAD)', async () => {
    const remote = gitStateRemote();
    const d = createPm2Deployer(deps({ lastGoodCommit: 'a1b2c3d4', httpGet: async () => ({ status: 200 }) }, remote));

    const rollback = await d.rollback();
    expect(rollback.ok).toBe(true);

    const deploy = await d.deploy(); // el `git pull --ff-only` no falla porque seguimos en la rama
    expect(deploy.ok).toBe(true);
  });

  it('seguridad: remoteDir con comilla simple literal se escapa POSIX (no rompe ni inyecta)', async () => {
    const remote = fakeRemote();
    const d = createPm2Deployer(deps({ remoteDir: "/var/www/it's-mine" }, remote));
    await d.deploy();
    // Escapado canónico: cada ' interna se vuelve '\'' dentro de las comillas simples.
    expect(remote.commands[0]).toContain("cd '/var/www/it'\\''s-mine'");
  });

  it('rollback aplicado pero la re-verificación falla → attempted true, ok false (no falla en silencio)', async () => {
    const d = createPm2Deployer(deps({ lastGoodCommit: 'a1b2c3d4', httpGet: async () => ({ status: 503 }) }));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: true, ok: false });
    expect(r.detail).toBeTruthy();
  });

  it('el checkout/restart del rollback falla → attempted true, ok false', async () => {
    const remote = fakeRemote({ seqCode: 1 });
    const d = createPm2Deployer(deps({ lastGoodCommit: 'a1b2c3d4' }, remote));
    const r = await d.rollback();
    expect(r).toMatchObject({ attempted: true, ok: false });
  });

  it('seguridad: lastGoodCommit no-hex no se interpola en el comando remoto → lanza', async () => {
    const d = createPm2Deployer(deps({ lastGoodCommit: 'abc123; rm -rf /' }));
    await expect(d.rollback()).rejects.toThrow(/commit/i);
  });
});
