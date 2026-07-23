/**
 * Deployer de Vercel (§6): deploy con `vercel --prod`, verificación real de la URL
 * de producción (200, con reintentos cortos), y rollback al deployment anterior.
 *
 * Las Llantas nunca gestiona el login/token/env de Vercel: usa la sesión de la CLI
 * que la persona ya tiene. Todo lo que toca el sistema (correr la CLI, pegar HTTP)
 * entra por deps inyectadas, así el deployer se testea entero con fakes.
 */

import { withRetries } from '../core/retry.js';
import type { Deployer, DeployOutcome, VerifyResult, RollbackResult } from '../core/types.js';

export interface VercelDeployerDeps {
  /** Corre la CLI de Vercel con los args dados. */
  runVercel: (args: string[]) => Promise<{ code: number; stdout: string }>;
  /** GET a una URL; devuelve el status HTTP. Puede tirar si la conexión falla. */
  httpGet: (url: string) => Promise<{ status: number }>;
  /** ¿El proyecto ya tuvo un deploy exitoso? (config.vercelDeployedOnce). Determina si hay a dónde volver. */
  hasPrevious: boolean;
  /** Endpoint de salud si el proyecto lo expone (ej. '/salud'); si no, se verifica la raíz. */
  healthPath?: string;
  /** Reintentos de la verificación (default: 3 intentos, 2s). */
  retry?: VerifyRetry;
}

/** Config de reintentos de la verificación post-deploy. */
export interface VerifyRetry {
  attempts: number;
  delayMs: number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: VerifyRetry = { attempts: 3, delayMs: 2000 };
const URL_RE = /https?:\/\/[^\s]+/g;

/** Extrae la última URL http(s) del output de Vercel (la de producción va al final). */
function extractUrl(stdout: string): string | undefined {
  const matches = stdout.match(URL_RE);
  return matches ? matches[matches.length - 1] : undefined;
}

/** Une la URL base con el healthPath, sin barra doble. */
function withHealthPath(url: string, healthPath?: string): string {
  if (!healthPath) return url;
  return url.replace(/\/$/, '') + healthPath;
}

export function createVercelDeployer(deps: VercelDeployerDeps): Deployer {
  const retry = deps.retry ?? DEFAULT_RETRY;

  return {
    async deploy(): Promise<DeployOutcome> {
      const { code, stdout } = await deps.runVercel(['--prod']);
      if (code !== 0) {
        return { ok: false, detail: 'vercel --prod salió con error' };
      }
      const url = extractUrl(stdout);
      if (!url) {
        return { ok: false, detail: 'no pude leer la URL de producción del output de Vercel' };
      }
      return { ok: true, url };
    },

    async verify(deploy: DeployOutcome): Promise<VerifyResult> {
      const url = deploy.url;
      if (!url) {
        return { ok: false, detail: 'no hay URL de producción para verificar' };
      }
      const target = withHealthPath(url, deps.healthPath);
      try {
        const res = await withRetries(() => deps.httpGet(target), {
          attempts: retry.attempts,
          delayMs: retry.delayMs,
          sleep: retry.sleep,
          isOk: (r) => r.status === 200,
        });
        return { ok: res.status === 200, status: res.status, url: target };
      } catch {
        // Se agotaron los reintentos con la conexión cayéndose.
        return { ok: false, url: target };
      }
    },

    async rollback(): Promise<RollbackResult> {
      if (!deps.hasPrevious) {
        return {
          attempted: false,
          ok: false,
          detail: 'primer deploy de este proyecto: no hay deployment anterior al cual volver',
        };
      }
      const { code } = await deps.runVercel(['rollback', '--yes']);
      return code === 0
        ? { attempted: true, ok: true }
        : { attempted: true, ok: false, detail: 'el rollback de Vercel falló' };
    },
  };
}
