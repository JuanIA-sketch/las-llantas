/**
 * Deployer de VPS + PM2 (§6). Todo corre sobre el server vía SSH ya configurado
 * (Las Llantas nunca gestiona la llave). Deploy: git pull → npm install → build? →
 * pm2 restart. Verificación: /salud (200) o, si el proyecto no lo expone, el
 * fallback MÁS DÉBIL de estado PM2 online — marcado como tal, sin maquillarlo.
 *
 * Rollback: a diferencia de Vercel (que guarda su propio historial), un VPS no lo
 * tiene gratis; el objetivo es `lastGoodCommit` (guardado en .llantas.json tras el
 * último deploy verificado). Se hace checkout de ese commit, se reinstala/reinicia y
 * se RE-verifica, dejando registrado si el rollback en sí funcionó.
 *
 * Los valores que se interpolan en comandos remotos (processName, commit, dir) se
 * validan/escapan: barrera contra inyección en el shell del server.
 */

import { withRetries } from '../core/retry.js';
import type { Deployer, DeployOutcome, VerifyResult, RollbackResult } from '../core/types.js';
import type { VerifyRetry } from './vercel.js';

export interface Pm2DeployerDeps {
  /** Corre un comando en el server remoto (SSH ya configurado). */
  runRemote: (command: string) => Promise<{ code: number; stdout: string }>;
  /** GET al endpoint de salud; puede tirar si no conecta. */
  httpGet: (url: string) => Promise<{ status: number }>;
  /** Directorio del proyecto en el server. */
  remoteDir: string;
  /** Nombre del proceso PM2. */
  processName: string;
  /** Rama de despliegue (ej. 'main'). El rollback vuelve a ELLA, no a un SHA suelto (evita detached HEAD). */
  branch: string;
  /** URL de /salud si el proyecto lo expone; si falta, se usa el fallback de estado PM2 (más débil). */
  healthUrl?: string;
  /** ¿Correr `npm run build` en el deploy? */
  hasBuild?: boolean;
  /** Último commit que pasó verificación (config.lastGoodCommit). undefined = primer deploy. */
  lastGoodCommit?: string;
  retry?: VerifyRetry;
}

const DEFAULT_RETRY: VerifyRetry = { attempts: 3, delayMs: 2000 };
const SAFE_NAME = /^[\w.-]+$/;
const SAFE_BRANCH = /^[\w./-]+$/;
const SAFE_REF = /^[0-9a-fA-F]{7,40}$/;

function assertName(name: string): void {
  if (!SAFE_NAME.test(name)) throw new Error(`Nombre de proceso PM2 no válido: ${JSON.stringify(name)}`);
}
function assertBranch(branch: string): void {
  if (!SAFE_BRANCH.test(branch)) throw new Error(`Nombre de rama no válido: ${JSON.stringify(branch)}`);
}
function assertRef(ref: string): void {
  if (!SAFE_REF.test(ref)) throw new Error(`Commit no válido para rollback: ${JSON.stringify(ref)}`);
}
/**
 * Escapado POSIX canónico para el shell del server (Linux): envuelve en comillas
 * simples y transforma cada comilla simple interna en `'\''`. Maneja correctamente
 * un valor con comilla simple literal adentro (sin romper ni permitir inyección).
 */
function quoteDir(dir: string): string {
  return `'${dir.replace(/'/g, "'\\''")}'`;
}

interface Pm2Process {
  name?: string;
  pm2_env?: { status?: string };
}

export function createPm2Deployer(deps: Pm2DeployerDeps): Deployer {
  const retry = deps.retry ?? DEFAULT_RETRY;

  /** Verificación de salud, compartida por verify() y el re-check del rollback. */
  async function verifyHealth(): Promise<VerifyResult> {
    if (deps.healthUrl) {
      const url = deps.healthUrl;
      try {
        const res = await withRetries(() => deps.httpGet(url), {
          attempts: retry.attempts,
          delayMs: retry.delayMs,
          sleep: retry.sleep,
          isOk: (r) => r.status === 200,
        });
        return { ok: res.status === 200, status: res.status, url };
      } catch {
        return { ok: false, url };
      }
    }

    // Fallback más débil: solo confirma que el proceso quedó online. NUNCA hace HTTP,
    // así que no distingue "vivo" de "vivo pero devolviendo 500". Va marcado weak:true.
    const weakDetail =
      'sin /salud configurado, solo confirmo que el proceso PM2 quedó online — NO que el servicio responda bien';
    const target = `pm2:${deps.processName}`;
    try {
      const res = await withRetries(() => pm2Online(), {
        attempts: retry.attempts,
        delayMs: retry.delayMs,
        sleep: retry.sleep,
        isOk: (r) => r.online,
      });
      return { ok: res.online, weak: true, detail: weakDetail, url: target };
    } catch {
      return { ok: false, weak: true, detail: weakDetail, url: target };
    }
  }

  async function pm2Online(): Promise<{ online: boolean }> {
    const res = await deps.runRemote('pm2 jlist');
    let list: Pm2Process[] = [];
    try {
      const parsed = JSON.parse(res.stdout || '[]');
      if (Array.isArray(parsed)) list = parsed as Pm2Process[];
    } catch {
      return { online: false };
    }
    const proc = list.find((p) => p.name === deps.processName);
    return { online: proc?.pm2_env?.status === 'online' };
  }

  return {
    async deploy(): Promise<DeployOutcome> {
      assertName(deps.processName);
      const dir = quoteDir(deps.remoteDir);

      const steps = [`cd ${dir}`, 'git pull --ff-only', 'npm install'];
      if (deps.hasBuild) steps.push('npm run build');
      steps.push(`pm2 restart ${deps.processName} --update-env`);

      const seq = await deps.runRemote(steps.join(' && '));
      if (seq.code !== 0) {
        return {
          ok: false,
          detail: 'la secuencia de deploy en el server falló (git pull / npm install / build / pm2 restart)',
        };
      }

      const head = await deps.runRemote(`cd ${dir} && git rev-parse HEAD`);
      return { ok: true, commit: head.stdout.trim() };
    },

    verify(_deploy: DeployOutcome): Promise<VerifyResult> {
      return verifyHealth();
    },

    async rollback(): Promise<RollbackResult> {
      if (!deps.lastGoodCommit) {
        return {
          attempted: false,
          ok: false,
          detail: 'primer deploy registrado: no hay último commit bueno al cual volver',
        };
      }
      assertRef(deps.lastGoodCommit);
      assertName(deps.processName);
      assertBranch(deps.branch);
      const dir = quoteDir(deps.remoteDir);

      // Volver a parar sobre la RAMA en el commit bueno (no un checkout suelto del SHA,
      // que dejaría detached HEAD y rompería el `git pull --ff-only` del próximo deploy).
      const steps = [
        `cd ${dir}`,
        `git checkout ${deps.branch}`,
        `git reset --hard ${deps.lastGoodCommit}`,
        'npm install',
      ];
      if (deps.hasBuild) steps.push('npm run build');
      steps.push(`pm2 restart ${deps.processName} --update-env`);

      const revert = await deps.runRemote(steps.join(' && '));
      if (revert.code !== 0) {
        return { attempted: true, ok: false, detail: 'el rollback falló al revertir/reinstalar/reiniciar en el server' };
      }

      // Volver a verificar tras el rollback — no puede quedar sin comprobar.
      const reVerify = await verifyHealth();
      return reVerify.ok
        ? { attempted: true, ok: true }
        : { attempted: true, ok: false, detail: 'rollback aplicado pero la verificación posterior también falló' };
    },
  };
}
