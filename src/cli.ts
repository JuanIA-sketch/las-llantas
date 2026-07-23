#!/usr/bin/env node
/**
 * Entry point de Las Llantas. `runCli(argv, deps)` es puro-de-orquestación con TODO
 * el I/O inyectado (mismo patrón que La Alarma), así se testea de punta a punta con
 * fakes del borde. `main()` arma las deps reales; el guard de abajo corre solo cuando
 * el archivo se invoca directamente.
 *
 * Esta versión cablea el flujo VERCEL. PM2 y npm reusan el mismo pipeline; se enchufan
 * después (por eso el pipeline y el Deployer ya son genéricos).
 */

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { detectType, type PackageJsonLike, type ProjectType } from './core/detect.js';
import {
  loadConfig,
  saveConfig,
  updateConfig,
  loadState,
  saveState,
  updateState,
  buildDetectProbe,
  STATE_FILENAME,
  type ConfigFs,
  type ProbeFs,
  type LlantasConfig,
} from './core/config.js';
import { runGate, GATE_PROFILES, type GateRuleId, type GateCheckRunner } from './core/gate.js';
import { runTestsCheck } from './preflight/run-tests.js';
import { gitCleanCheck } from './preflight/git-status.js';
import { scanWorkingTree, type ScanFsDeps } from './preflight/secret-scan.js';
import { createVercelDeployer } from './deployers/vercel.js';
import { createPm2Deployer } from './deployers/pm2.js';
import { createNpmDeployer } from './deployers/npm.js';
import { extractPm2Settings } from './core/ecosystem.js';
import {
  checkVersionBumped,
  checkVersionNotDuplicate,
  type RegistryLookup,
} from './preflight/npm-version.js';
import { runDeploy, type PipelineDeps } from './core/pipeline.js';
import { friendlyError } from './core/errors.js';
import type { Prompt } from './prompt.js';

/** Todo el I/O que necesita el cli, inyectable. La entrada real pasa las impls de verdad. */
export interface CliDeps {
  cwd: string;
  log: (msg: string) => void;
  prompt: Prompt;
  configFs: ConfigFs;
  listEntries: (cwd: string) => Promise<string[]>;
  readPackageJson: (cwd: string) => Promise<Record<string, unknown> | null>;
  scanFs: ScanFsDeps;
  runCommand: (cwd: string, command: string, args: string[]) => Promise<{ code: number }>;
  /** Como runCommand pero devuelve stdout (para `npm view` / `npm publish`). */
  runCommandOut: (cwd: string, command: string, args: string[]) => Promise<{ code: number; stdout: string }>;
  runGit: (cwd: string, args: string[]) => Promise<{ code: number; stdout: string }>;
  vercelRunner: (cwd: string) => (args: string[]) => Promise<{ code: number; stdout: string }>;
  httpGet: (url: string) => Promise<{ status: number }>;
  /** Runner SSH atado a un target (para PM2). */
  sshRunner: (target: string) => (command: string) => Promise<{ code: number; stdout: string }>;
  /** Carga el ecosystem.config.js del proyecto (dynamic import en la impl real). */
  loadEcosystem: (cwd: string) => Promise<unknown>;
}

/** Interpreta la respuesta de "¿es Vercel, VPS o npm?". */
function parseTypeAnswer(answer: string): ProjectType | null {
  const a = answer.trim().toLowerCase();
  if (a === 'vercel') return 'vercel';
  if (a === 'vps' || a === 'pm2') return 'pm2';
  if (a === 'npm') return 'npm';
  return null;
}

const VERCEL_PLAN = [
  '📋 Voy a hacer esto (Vercel):',
  '   1. Pre-flight: tests en verde + git limpio + escaneo de secretos',
  '   2. Deploy: vercel --prod (con tu sesión de Vercel ya logueada)',
  '   3. Verificar 200 en la URL de producción (con reintentos cortos)',
  '   4. Si la verificación falla: rollback al deployment anterior',
].join('\n');

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const dryRun = argv.includes('--dry-run');
  const configPath = join(deps.cwd, '.llantas.json');
  let config = await loadConfig(configPath, deps.configFs);

  // Detección (§5). El type recordado viaja en el probe; detect.ts se queda puro.
  const probeFs: ProbeFs = {
    listEntries: deps.listEntries,
    readPackageJson: async (c) => (await deps.readPackageJson(c)) as PackageJsonLike | null,
  };
  const detected = detectType(await buildDetectProbe(deps.cwd, config, probeFs));

  let type: ProjectType;
  if (detected.kind === 'needs-confirmation') {
    const motivo = detected.reason === 'ambiguous' ? 'las señales se contradicen' : 'no tiene una firma clara';
    const answer = await deps.prompt.ask(
      `No reconozco este proyecto (${motivo}). ¿Es Vercel, VPS o npm? (vercel/vps/npm)`,
    );
    const parsed = parseTypeAnswer(answer);
    if (!parsed) {
      deps.log(`No entendí "${answer}". Volvé a correr e indicá: vercel, vps o npm.`);
      return 1;
    }
    type = parsed;
    config = updateConfig(config, { type });
    await saveConfig(configPath, config, deps.configFs);
    deps.log(`Anotado en .llantas.json: este proyecto es ${type}. No lo vuelvo a preguntar.`);
  } else {
    type = detected.kind;
  }

  if (type === 'vercel') return runVercelFlow(deps, config, configPath, dryRun);
  if (type === 'pm2') return runPm2Flow(deps, config, configPath, dryRun);
  return runNpmFlow(deps, config, configPath, dryRun);
}

/** Los 3 checks compartidos del gate (tests + git limpio + escaneo de secretos). */
function sharedGateRunners(deps: CliDeps): Partial<Record<GateRuleId, GateCheckRunner>> {
  const { cwd } = deps;
  return {
    tests: () =>
      runTestsCheck(cwd, {
        readPackageJson: async (c) =>
          (await deps.readPackageJson(c)) as { scripts?: Record<string, unknown> } | null,
        runCommand: deps.runCommand,
      }),
    'git-clean': () => gitCleanCheck(cwd, { runGit: deps.runGit }),
    'secret-scan': async () => {
      const findings = await scanWorkingTree(cwd, deps.scanFs);
      if (findings.length === 0) return { ok: true };
      const where = findings.map((f) => `${f.file}:${f.line}`).join(', ');
      return { ok: false, detail: `${findings.length} posible(s) secreto(s) en el working tree (${where})` };
    },
  };
}

async function runVercelFlow(
  deps: CliDeps,
  config: LlantasConfig,
  configPath: string,
  dryRun: boolean,
): Promise<number> {
  // Primera corrida = todavía no hubo un deploy verificado (NO "existe .llantas.json").
  const needsConfirmation = config.vercelDeployedOnce !== true;

  const deployer = createVercelDeployer({
    runVercel: deps.vercelRunner(deps.cwd),
    httpGet: deps.httpGet,
    hasPrevious: config.vercelDeployedOnce === true,
  });

  const result = await runDeploy({
    runGate: () => runGate(GATE_PROFILES.vercel, sharedGateRunners(deps)),
    deployer,
    needsConfirmation,
    confirm: () => deps.prompt.confirm('¿Despliego a producción en Vercel?'),
    dryRun,
    onVerified: async () => {
      await saveConfig(configPath, updateConfig(config, { vercelDeployedOnce: true }), deps.configFs);
    },
    log: deps.log,
    planText: VERCEL_PLAN,
  });
  return result.ok ? 0 : 1;
}

const PM2_PLAN = [
  '📋 Voy a hacer esto (VPS + PM2):',
  '   1. Pre-flight: tests + git limpio + escaneo de secretos + SSH responde',
  '   2. Deploy en el server: git pull → npm install → build? → pm2 restart',
  '   3. Verificar /salud (200) — o, si no lo expone, estado PM2 online (verificación más débil)',
  '   4. Si la verificación falla: rollback al último commit bueno + re-verificar',
].join('\n');

async function runPm2Flow(
  deps: CliDeps,
  config: LlantasConfig,
  configPath: string,
  dryRun: boolean,
): Promise<number> {
  const parsed = extractPm2Settings(await deps.loadEcosystem(deps.cwd));
  if (!parsed.ok) {
    deps.log(`No pude leer la config de deploy: ${parsed.error}`);
    return 1;
  }
  const { sshTarget, remoteDir, processName, branch } = parsed.settings;
  const runRemote = deps.sshRunner(sshTarget);

  const pkg = await deps.readPackageJson(deps.cwd);
  const scripts = (pkg?.scripts ?? {}) as Record<string, unknown>;
  const hasBuild = typeof scripts.build === 'string';

  // `lastGoodCommit` vive en el estado MUTABLE gitignoreado (cambia en cada deploy);
  // no en `.llantas.json` (commiteado), para no ensuciar el árbol deploy a deploy.
  const statePath = join(deps.cwd, STATE_FILENAME);
  const state = await loadState(statePath, deps.configFs);

  const ignored = await deps.runGit(deps.cwd, ['check-ignore', STATE_FILENAME]);
  if (ignored.code === 1) {
    deps.log(
      `⚠️  Agregá \`${STATE_FILENAME}\` a tu .gitignore — guarda el puntero de rollback y NO debe commitearse (si no, cada deploy dejaría el working tree sucio).`,
    );
  }

  const gateRunners: Partial<Record<GateRuleId, GateCheckRunner>> = {
    ...sharedGateRunners(deps),
    'ssh-reachable': async () => {
      const r = await runRemote('echo llantas-ok');
      return r.code === 0 && r.stdout.includes('llantas-ok')
        ? { ok: true }
        : { ok: false, detail: 'no pude conectarme por SSH al server (revisá que el acceso esté configurado)' };
    },
  };

  const deployer = createPm2Deployer({
    runRemote,
    httpGet: deps.httpGet,
    remoteDir,
    processName,
    branch,
    healthUrl: config.healthUrl,
    hasBuild,
    lastGoodCommit: state.lastGoodCommit,
  });

  // Primera corrida pm2 = todavía no hay puntero de "último commit bueno".
  const needsConfirmation = state.lastGoodCommit == null;

  const result = await runDeploy({
    runGate: () => runGate(GATE_PROFILES.pm2, gateRunners),
    deployer,
    needsConfirmation,
    confirm: () => deps.prompt.confirm('¿Despliego a producción en el VPS (PM2)?'),
    dryRun,
    onVerified: async (deploy) => {
      await saveState(statePath, updateState(state, { lastGoodCommit: deploy.commit }), deps.configFs);
    },
    log: deps.log,
    planText: PM2_PLAN,
  });
  return result.ok ? 0 : 1;
}

const NPM_PLAN = [
  '📋 Voy a hacer esto (npm) — OJO: publicar NO tiene vuelta atrás:',
  '   1. Pre-flight estricto: tests + git limpio + secretos + versión subida y no duplicada',
  '   2. Publish: npm publish (con tu login de npm) — SIEMPRE pido confirmación antes',
  '   3. Verificar con `npm view` que la versión quedó publicada',
  '   4. Sin rollback: si te equivocaste, se sugiere `npm deprecate` a mano',
].join('\n');

async function runNpmFlow(
  deps: CliDeps,
  config: LlantasConfig,
  configPath: string,
  dryRun: boolean,
): Promise<number> {
  const pkg = await deps.readPackageJson(deps.cwd);
  const name = pkg?.name;
  const version = pkg?.version;
  if (typeof name !== 'string' || typeof version !== 'string') {
    deps.log('El package.json necesita `name` y `version` para publicar en npm.');
    return 1;
  }

  const registryLookup: RegistryLookup = async () => {
    const { code, stdout } = await deps.runCommandOut(deps.cwd, 'npm', ['view', name, 'version']);
    const v = stdout.trim();
    return { published: code === 0 && v !== '', version: v };
  };

  // Confirmación de identidad UNA vez (§5): habilita el publish automático de ESTE paquete.
  if (!dryRun && config.npmIdentityConfirmed !== true) {
    const okId = await deps.prompt.confirm(
      `Vas a habilitar el publish automático del paquete "${name}" en npm. ¿Es el paquete correcto?`,
    );
    if (!okId) {
      deps.log('Cancelado. No confirmaste la identidad del paquete.');
      return 1;
    }
    config = updateConfig(config, { npmIdentityConfirmed: true });
    await saveConfig(configPath, config, deps.configFs);
  }

  const gateRunners: Partial<Record<GateRuleId, GateCheckRunner>> = {
    ...sharedGateRunners(deps),
    'version-bumped': () => checkVersionBumped(version, registryLookup),
    'version-not-duplicate': () => checkVersionNotDuplicate(version, registryLookup),
  };

  const deployer = createNpmDeployer({
    localVersion: version,
    runPublish: () => deps.runCommandOut(deps.cwd, 'npm', ['publish']),
    registryVersion: registryLookup,
  });

  const result = await runDeploy({
    runGate: () => runGate(GATE_PROFILES.npm, gateRunners),
    deployer,
    needsConfirmation: true, // npm: SIEMPRE confirma antes de publicar, sin excepción
    confirm: () => deps.prompt.confirm(`¿Publico ${name}@${version} en npm? (no tiene vuelta atrás)`),
    dryRun,
    onVerified: async () => {
      /* npm no persiste puntero de rollback: no hay a dónde volver */
    },
    log: deps.log,
    planText: NPM_PLAN,
  });
  return result.ok ? 0 : 1;
}

/** Carga el ecosystem.config.js/.cjs del proyecto (dynamic import). null si no existe. */
async function loadEcosystemModule(cwd: string): Promise<unknown> {
  for (const name of ['ecosystem.config.js', 'ecosystem.config.cjs']) {
    try {
      return await import(pathToFileURL(join(cwd, name)).href);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ERR_MODULE_NOT_FOUND') continue;
      throw err;
    }
  }
  return null;
}

/** Arma las deps reales y corre el cli. Devuelve el exit code. */
export async function main(argv: string[], cwd: string): Promise<number> {
  const { realConfigFs, listEntries, readPackageJson, listScannableFiles, readTextFile } = await import(
    './runners/fs.js'
  );
  const { nodeRunCommand, nodeRunCommandOut, gitRunner, vercelRunner } = await import('./runners/exec.js');
  const { httpGet } = await import('./runners/http.js');
  const { sshRunner } = await import('./runners/ssh.js');
  const { createReadlinePrompt } = await import('./prompt.js');

  const prompt = createReadlinePrompt();
  try {
    return await runCli(argv, {
      cwd,
      log: (m) => console.log(m),
      prompt,
      configFs: realConfigFs,
      listEntries,
      readPackageJson,
      scanFs: { listFiles: listScannableFiles, readFile: readTextFile },
      runCommand: nodeRunCommand,
      runCommandOut: nodeRunCommandOut,
      runGit: gitRunner,
      vercelRunner,
      httpGet,
      sshRunner,
      loadEcosystem: (dir: string) => loadEcosystemModule(dir),
    });
  } catch (err) {
    console.error(`❌ ${friendlyError(err)}`);
    return 2;
  } finally {
    prompt.close();
  }
}

// Entry point: solo cuando el archivo se invoca directamente (o vía el shim que llama a main()).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.cwd()).then((code) => process.exit(code));
}
