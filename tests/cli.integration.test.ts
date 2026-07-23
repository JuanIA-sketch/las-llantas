import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, type CliDeps } from '../src/cli.js';
import { realConfigFs, listEntries, readPackageJson, listScannableFiles, readTextFile } from '../src/runners/fs.js';
import { gitRunner } from '../src/runners/exec.js';
import { SYNTHETIC_TOKEN } from './support/synthetic-secrets.js';

const created: string[] = [];
afterAll(async () => {
  await Promise.all(created.map((d) => rm(d, { recursive: true, force: true })));
});

/** Crea un proyecto Vercel temporal (package.json + vercel.json) con archivos extra opcionales. */
async function makeVercelProject(extra: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'llantas-cli-'));
  created.push(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
  await writeFile(join(dir, 'vercel.json'), '{}', 'utf8');
  await writeFile(join(dir, 'index.js'), 'console.log("hola");\n', 'utf8');
  for (const [name, content] of Object.entries(extra)) {
    await writeFile(join(dir, name), content, 'utf8');
  }
  return dir;
}

/**
 * Prompt guionado: respuestas de `ask` en cola. `confirmValue` puede ser un booleano
 * fijo o una COLA de booleanos (para probar confirmaciones separadas, ej. identidad
 * sí / publish no).
 */
function scriptedPrompt(answers: string[] = [], confirmValue: boolean | boolean[] = true) {
  const asked: string[] = [];
  const queue = Array.isArray(confirmValue) ? [...confirmValue] : null;
  return {
    prompt: {
      ask: async (q: string) => { asked.push(q); return answers.shift() ?? ''; },
      confirm: async () => (queue ? (queue.shift() ?? false) : (confirmValue as boolean)),
    },
    asked,
  };
}

function makeDeps(
  cwd: string,
  over: Partial<CliDeps> = {},
  pm2HealthStatus = 200,
): { deps: CliDeps; log: string[]; calls: any } {
  const log: string[] = [];
  const calls = { vercel: [] as string[][], http: [] as string[], ssh: [] as string[], npm: [] as string[][] };
  // Registro npm simulado: `npm publish` mueve la versión publicada a la local.
  let registryVersion = '1.2.2';
  const deps: CliDeps = {
    cwd,
    log: (m) => log.push(m),
    prompt: scriptedPrompt().prompt,
    configFs: realConfigFs,
    listEntries,
    readPackageJson,
    scanFs: { listFiles: listScannableFiles, readFile: readTextFile },
    // Fakes del borde externo: nunca se toca producción real.
    runCommand: async () => ({ code: 0 }),
    runCommandOut: async (_cwd, _command, args) => {
      calls.npm.push(args);
      if (args[0] === 'view') return { code: 0, stdout: `${registryVersion}\n` };
      if (args[0] === 'publish') { registryVersion = '1.2.3'; return { code: 0, stdout: '+ demo-lib@1.2.3' }; }
      return { code: 0, stdout: '' };
    },
    runGit: async () => ({ code: 0, stdout: '' }),
    vercelRunner: (_cwd) => async (args) => {
      calls.vercel.push(args);
      return { code: 0, stdout: 'Production: https://demo-abc.vercel.app' };
    },
    httpGet: async (url) => { calls.http.push(url); return { status: 200 }; },
    sshRunner: (_target) => async (command) => {
      calls.ssh.push(command);
      // La verificación de /salud corre por SSH DENTRO del server (curl), no como fetch local.
      if (command.includes('curl')) return { code: 0, stdout: String(pm2HealthStatus) };
      if (command.includes('rev-parse')) return { code: 0, stdout: 'a1b2c3d4e5f6\n' };
      if (command.includes('pm2 jlist')) {
        return { code: 0, stdout: JSON.stringify([{ name: 'demo', pm2_env: { status: 'online' } }]) };
      }
      return { code: 0, stdout: 'llantas-ok' };
    },
    loadEcosystem: async () => ({
      apps: [{ name: 'demo' }],
      deploy: { production: { user: 'deploy', host: 'srv.example.com', path: '/var/www/demo', ref: 'origin/main' } },
    }),
    ...over,
  };
  return { deps, log, calls };
}

/** Crea un proyecto npm (librería) temporal: package.json con main, sin firma de app. */
async function makeNpmProject(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'llantas-npm-'));
  created.push(dir);
  await writeFile(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'demo-lib', version: '1.2.3', main: 'index.js' }),
    'utf8',
  );
  await writeFile(join(dir, 'index.js'), 'module.exports = 42;\n', 'utf8');
  return dir;
}

/** Crea un proyecto PM2 temporal (package.json + ecosystem.config.js). */
async function makePm2Project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'llantas-pm2-'));
  created.push(dir);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
  await writeFile(join(dir, 'ecosystem.config.js'), 'module.exports = {};\n', 'utf8');
  await writeFile(join(dir, 'index.js'), 'console.log("srv");\n', 'utf8');
  return dir;
}

async function readLlantas(dir: string): Promise<any> {
  return JSON.parse(await readFile(join(dir, '.llantas.json'), 'utf8'));
}

async function readLlantasState(dir: string): Promise<any> {
  return JSON.parse(await readFile(join(dir, '.llantas.state.json'), 'utf8'));
}

/** lastGoodCommit del estado, o undefined si el archivo no existe (deploy débil nunca lo escribe). */
async function lastGoodCommitOf(dir: string): Promise<string | undefined> {
  try {
    return JSON.parse(await readFile(join(dir, '.llantas.state.json'), 'utf8')).lastGoodCommit;
  } catch {
    return undefined;
  }
}

/**
 * Repo git real con firma PM2, `.gitignore` que cubre el estado mutable, y un
 * `.llantas.json` con healthUrl ya committeado — así los deploys son FUERTES
 * (verifican por HTTP) y persisten lastGoodCommit al estado gitignoreado.
 */
async function makePm2GitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'llantas-pm2git-'));
  created.push(dir);
  const git = (args: string[]) => execFileSync('git', args, { cwd: dir });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }), 'utf8');
  await writeFile(join(dir, 'ecosystem.config.js'), 'module.exports = {};\n', 'utf8');
  await writeFile(join(dir, 'index.js'), 'console.log("srv");\n', 'utf8');
  await writeFile(
    join(dir, '.llantas.json'),
    JSON.stringify({ type: 'pm2', healthUrl: 'https://demo.example.com/salud' }),
    'utf8',
  );
  await writeFile(join(dir, '.gitignore'), '.llantas.state.json\nnode_modules/\n', 'utf8');
  git(['add', '.']);
  git(['commit', '-q', '-m', 'init']);
  return dir;
}

describe('cli — flujo Vercel de punta a punta (fs real, borde externo mockeado)', () => {
  it('--dry-run: corre el gate real, muestra el plan y NO despliega', async () => {
    const dir = await makeVercelProject();
    const { deps, log, calls } = makeDeps(dir);

    const code = await runCli(['--dry-run'], deps);

    expect(code).toBe(0);
    expect(calls.vercel).toHaveLength(0); // no desplegó
    expect(log.join('\n')).toMatch(/Dry-run/i);
  });

  it('primera corrida: pide confirmación, despliega, verifica 200 y persiste vercelDeployedOnce', async () => {
    const dir = await makeVercelProject();
    const { prompt } = scriptedPrompt([], true);
    const { deps, calls } = makeDeps(dir, { prompt });

    const code = await runCli([], deps);

    expect(code).toBe(0);
    expect(calls.vercel).toContainEqual(['--prod']); // desplegó
    expect(calls.http[0]).toBe('https://demo-abc.vercel.app'); // verificó la URL
    expect(await readLlantas(dir)).toMatchObject({ vercelDeployedOnce: true });
  });

  it('primera corrida pero el usuario NO confirma → no despliega ni persiste', async () => {
    const dir = await makeVercelProject();
    const { prompt } = scriptedPrompt([], false);
    const { deps, calls } = makeDeps(dir, { prompt });

    const code = await runCli([], deps);

    expect(code).toBe(1);
    expect(calls.vercel).toHaveLength(0);
  });

  it('un secreto en el working tree bloquea el gate → no despliega [§9]', async () => {
    const dir = await makeVercelProject({ '.env': `TOKEN=${SYNTHETIC_TOKEN}\n` });
    const { deps, log, calls } = makeDeps(dir);

    const code = await runCli([], deps);

    expect(code).toBe(1);
    expect(calls.vercel).toHaveLength(0);
    expect(log.join('\n')).toMatch(/gate|secreto/i);
  });
});

describe('cli — flujo VPS+PM2 de punta a punta (ecosystem real detectado, borde SSH/HTTP mockeado)', () => {
  it('primera corrida con /salud: gate → deploy → verificación FUERTE (200) → persiste lastGoodCommit', async () => {
    const dir = await makePm2Project();
    // Configuramos /salud en la pregunta del primer deploy → verificación fuerte.
    const { prompt } = scriptedPrompt(['https://demo.example.com/salud'], true);
    const { deps, calls } = makeDeps(dir, { prompt });

    const code = await runCli([], deps);

    expect(code).toBe(0);
    expect(calls.ssh.some((c: string) => c.includes('git pull'))).toBe(true); // desplegó en el server
    expect(calls.ssh).toContain('echo llantas-ok'); // corrió el check de SSH del gate
    // Verificación FUERTE: curl por SSH DENTRO del server (no fetch local), contra el /salud.
    expect(calls.ssh.some((c: string) => c.includes('curl') && c.includes('https://demo.example.com/salud'))).toBe(true);
    expect(calls.http).toHaveLength(0); // el flujo PM2 NO hace fetch local
    // El puntero de rollback va al estado MUTABLE gitignoreado, NO al .llantas.json commiteado.
    expect(await readLlantasState(dir)).toMatchObject({ lastGoodCommit: 'a1b2c3d4e5f6' });
    expect(await readLlantas(dir)).toMatchObject({ healthUrl: 'https://demo.example.com/salud' });
  });

  it('dos deploys PM2 FUERTES seguidos NO dejan el working tree sucio (lastGoodCommit va al estado gitignoreado)', async () => {
    const dir = await makePm2GitRepo(); // ya trae .llantas.json con healthUrl committeado → deploys fuertes
    const porcelain = () => execFileSync('git', ['status', '--porcelain'], { cwd: dir }).toString().trim();
    expect(porcelain()).toBe(''); // arranca limpio

    // Deploy 1: primera corrida (confirma). runGit REAL + verificación fuerte (httpGet 200 por default).
    const run1 = makeDeps(dir, { prompt: scriptedPrompt([], true).prompt, runGit: gitRunner });
    expect(await runCli([], run1.deps)).toBe(0);
    expect(porcelain()).toBe(''); // limpio tras deploy 1 (lastGoodCommit está en el archivo gitignoreado)

    // Deploy 2: ya hay lastGoodCommit → NO confirma. confirm=false a propósito: si preguntara, cancelaría.
    const run2 = makeDeps(dir, { prompt: scriptedPrompt([], false).prompt, runGit: gitRunner });
    expect(await runCli([], run2.deps)).toBe(0);
    expect(porcelain()).toBe(''); // sigue limpio tras deploy 2

    expect((await readLlantasState(dir)).lastGoodCommit).toBeTruthy();
  });

  it('BUG contenido estructuralmente: sin /salud, app 500 pero proceso online → "exitoso" DÉBIL, advertencia VISIBLE, y NO avanza lastGoodCommit', async () => {
    const dir = await makePm2Project();
    // Saltamos /salud ('') → fallback débil. La app está rota (500), pero el fallback no consulta HTTP.
    const { prompt } = scriptedPrompt([''], true);
    const { deps, log } = makeDeps(dir, { prompt }, 500);

    const code = await runCli([], deps);

    expect(code).toBe(0); // "exitoso"… pero débil
    const out = log.join('\n');
    expect(out).toMatch(/VERIFICACIÓN DÉBIL/); // advertencia imposible de perder
    expect(out).toMatch(/rollback NO avanzó/i);
    // El fix estructural: el puntero de rollback NO se movió a un commit no confirmado.
    expect(await lastGoodCommitOf(dir)).toBeUndefined();
  });

  it('dos deploys DÉBILES seguidos → lastGoodCommit NO cambia (nunca avanza sin verificación fuerte)', async () => {
    const dir = await makePm2Project();
    expect(await lastGoodCommitOf(dir)).toBeUndefined(); // arranca sin puntero

    // Deploy 1 débil (salta /salud, proceso online): "exitoso" pero no persiste.
    const run1 = makeDeps(dir, { prompt: scriptedPrompt([''], true).prompt });
    expect(await runCli([], run1.deps)).toBe(0);
    const after1 = await lastGoodCommitOf(dir);

    // Deploy 2 débil también: sigue sin avanzar.
    const run2 = makeDeps(dir, { prompt: scriptedPrompt([''], true).prompt });
    expect(await runCli([], run2.deps)).toBe(0);
    const after2 = await lastGoodCommitOf(dir);

    expect(after1).toBeUndefined();
    expect(after2).toBe(after1); // no cambió entre uno y otro
  });

  it('el fix en acción: con /salud configurado en el primer deploy, un 500 hace fallar la verificación FUERTE (no lo acepta)', async () => {
    const dir = await makePm2Project();
    // Esta vez SÍ damos la URL de salud; la app devuelve 500 (curl por SSH la ve).
    const { prompt } = scriptedPrompt(['https://demo.example.com/salud'], true);
    const { deps } = makeDeps(dir, { prompt }, 500);

    const code = await runCli([], deps);

    expect(code).toBe(1); // verificación fuerte falla → NO exitoso
    expect(await readLlantas(dir)).toMatchObject({ healthUrl: 'https://demo.example.com/salud' }); // quedó configurado
  });

  it('--dry-run PM2: corre el gate (incl. SSH) y no despliega', async () => {
    const dir = await makePm2Project();
    const { deps, calls } = makeDeps(dir);

    const code = await runCli(['--dry-run'], deps);

    expect(code).toBe(0);
    expect(calls.ssh.some((c: string) => c.includes('git pull'))).toBe(false); // no desplegó
  });
});

describe('cli — flujo npm de punta a punta (detect npm por firma de librería)', () => {
  it('primera corrida: confirma identidad + publish, gate de versión, verifica y marca npmIdentityConfirmed', async () => {
    const dir = await makeNpmProject(); // version local 1.2.3, registro simulado 1.2.2
    const { prompt } = scriptedPrompt([], true); // confirma identidad y publish
    const { deps, calls } = makeDeps(dir, { prompt });

    const code = await runCli([], deps);

    expect(code).toBe(0);
    expect(calls.npm).toContainEqual(['publish']); // publicó
    expect(calls.npm.some((a: string[]) => a[0] === 'view')).toBe(true); // consultó el registro
    expect(await readLlantas(dir)).toMatchObject({ npmIdentityConfirmed: true });
  });

  it('identidad y publish son confirmaciones SEPARADAS: sí a identidad + NO a publish → no publica, pero recuerda la identidad', async () => {
    const dir = await makeNpmProject();
    const { prompt } = scriptedPrompt([], [true, false]); // 1ª (identidad)=sí, 2ª (publish)=no
    const { deps, calls } = makeDeps(dir, { prompt });

    const code = await runCli([], deps);

    expect(code).toBe(1);
    expect(calls.npm.some((a: string[]) => a[0] === 'publish')).toBe(false); // dijo NO al publish → no publicó
    expect(await readLlantas(dir)).toMatchObject({ npmIdentityConfirmed: true }); // pero la identidad SÍ quedó confirmada
  });

  it('versión ya publicada (misma que la del registro) → gate bloquea, NO publica [§9]', async () => {
    const dir = await makeNpmProject(); // local 1.2.3
    const npmCalls: string[][] = [];
    const { deps } = makeDeps(dir, {
      // Registro ya en 1.2.3 → version-not-duplicate y version-bumped bloquean.
      runCommandOut: async (_c, _cmd, args) => {
        npmCalls.push(args);
        if (args[0] === 'view') return { code: 0, stdout: '1.2.3\n' };
        return { code: 0, stdout: '' };
      },
    });

    const code = await runCli([], deps);

    expect(code).toBe(1);
    expect(npmCalls.some((a) => a[0] === 'publish')).toBe(false); // nunca publicó
  });
});

describe('cli — "no reconozco este proyecto" (§5, §9)', () => {
  it('proyecto sin firma → pregunta una vez, guarda el type y en la corrida siguiente NO vuelve a preguntar', async () => {
    // Carpeta sin vercel.json/ecosystem y sin package.json de librería → needs-confirmation.
    const dir = await mkdtemp(join(tmpdir(), 'llantas-unknown-'));
    created.push(dir);
    await writeFile(join(dir, 'README.md'), '# hola\n', 'utf8');

    // Primera corrida: responde "vercel"; luego el flujo Vercel completa con los fakes.
    const first = scriptedPrompt(['vercel'], true);
    const run1 = makeDeps(dir, { prompt: first.prompt });
    const code1 = await runCli([], run1.deps);

    expect(code1).toBe(0);
    expect(first.asked).toHaveLength(1); // preguntó una vez
    expect(await readLlantas(dir)).toMatchObject({ type: 'vercel' });

    // Segunda corrida: NO debe volver a preguntar (lee el type de .llantas.json).
    const second = scriptedPrompt([], true);
    const run2 = makeDeps(dir, { prompt: second.prompt });
    const code2 = await runCli(['--dry-run'], run2.deps);

    expect(code2).toBe(0);
    expect(second.asked).toHaveLength(0); // no volvió a preguntar
  });
});
