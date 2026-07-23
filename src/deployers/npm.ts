/**
 * Deployer de npm publish (§6) — el único SIN vuelta atrás. Por eso el pre-flight
 * (chequeos de versión, en npm-version.ts) es el más estricto y la confirmación es
 * SIEMPRE (la maneja el cli via needsConfirmation, nunca se saltea).
 *
 * Deploy: `npm publish` (usando el login de npm que la persona ya tiene).
 * Verify: `npm view <pkg> version` post-publish, con reintento corto por si el
 *   registro tarda en reflejarlo.
 * Rollback: NO EXISTE. Publicado es publicado. Se sugiere `npm deprecate` a mano.
 */

import { withRetries } from '../core/retry.js';
import type { Deployer, DeployOutcome, VerifyResult, RollbackResult } from '../core/types.js';
import type { RegistryLookup } from '../preflight/npm-version.js';
import type { VerifyRetry } from './vercel.js';

export interface NpmDeployerDeps {
  /** Versión local (de package.json). */
  localVersion: string;
  /** Corre `npm publish`. */
  runPublish: () => Promise<{ code: number; stdout: string }>;
  /** Mira el registro (`npm view <pkg> version`) para verificar el publish. */
  registryVersion: RegistryLookup;
  retry?: VerifyRetry;
}

const DEFAULT_RETRY: VerifyRetry = { attempts: 3, delayMs: 2000 };

export function createNpmDeployer(deps: NpmDeployerDeps): Deployer {
  const retry = deps.retry ?? DEFAULT_RETRY;

  return {
    async deploy(): Promise<DeployOutcome> {
      const { code } = await deps.runPublish();
      return code === 0
        ? { ok: true }
        : { ok: false, detail: 'npm publish salió con error' };
    },

    async verify(_deploy: DeployOutcome): Promise<VerifyResult> {
      try {
        const reg = await withRetries(() => deps.registryVersion(), {
          attempts: retry.attempts,
          delayMs: retry.delayMs,
          sleep: retry.sleep,
          isOk: (r) => r.published && r.version === deps.localVersion,
        });
        const ok = reg.published && reg.version === deps.localVersion;
        return ok
          ? { ok: true, detail: `el registro ya refleja la versión ${deps.localVersion}` }
          : { ok: false, detail: 'el registro no refleja la versión publicada tras los reintentos' };
      } catch {
        return { ok: false, detail: 'no pude consultar el registro para verificar el publish' };
      }
    },

    async rollback(): Promise<RollbackResult> {
      return {
        attempted: false,
        ok: false,
        detail:
          'npm publish no tiene rollback: publicado es publicado. Si fue un error, considerá `npm deprecate <paquete>@<versión>` como acción manual.',
      };
    },
  };
}
