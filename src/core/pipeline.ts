/**
 * Orquestador de las 3 fases del deploy (§6): gate → mostrar plan → [confirmar] →
 * deploy → verify → rollback si falla. Genérico: recibe un `Deployer` (vercel/pm2/npm)
 * y los checks ya armados, así el mismo flujo sirve para los 3 tipos.
 *
 * Reglas clave (del brief):
 * - `--dry-run` muestra el plan y NO ejecuta NADA (ni siquiera el gate) (§8).
 * - Confirmación: `needsConfirmation` lo decide el llamador (npm SIEMPRE; vercel/pm2
 *   solo en la primera corrida). El pipeline solo lo respeta.
 * - `onVerified` (persistir el éxito: vercelDeployedOnce / lastGoodCommit) se llama
 *   SOLO tras una verificación OK — nunca si el deploy o la verificación fallan.
 * - Si la verificación falla, se dispara el rollback y su resultado queda registrado
 *   (funcionó o no), nunca en silencio (§9).
 */

import { formatGateResults } from './gate.js';
import type { Deployer } from './types.js';
import type { GateResult } from './gate.js';
import type { DeployOutcome, VerifyResult, RollbackResult } from './types.js';

export type PipelineStage = 'gate' | 'plan' | 'confirm' | 'deploy' | 'verify' | 'rollback' | 'done';

export interface PipelineResult {
  ok: boolean;
  /** En qué fase terminó el flujo. */
  stage: PipelineStage;
  gate?: GateResult;
  deploy?: DeployOutcome;
  verify?: VerifyResult;
  rollback?: RollbackResult;
  detail?: string;
}

export interface PipelineDeps {
  /** Gate ya armado (perfil + runners) para este tipo. */
  runGate: () => Promise<GateResult>;
  deployer: Deployer;
  /** ¿Pedir confirmación? npm SIEMPRE; vercel/pm2 solo en la primera corrida. Lo decide el llamador. */
  needsConfirmation: boolean;
  confirm: () => Promise<boolean>;
  dryRun: boolean;
  /** Persiste el éxito (vercelDeployedOnce=true / lastGoodCommit). Solo tras verify OK. Recibe el deploy (ej. su commit). */
  onVerified: (deploy: DeployOutcome) => Promise<void>;
  log: (msg: string) => void;
  /** Descripción legible de lo que se hará (mostrar plan, §8). */
  planText: string;
}

export async function runDeploy(deps: PipelineDeps): Promise<PipelineResult> {
  // Fase 1 — pre-flight gate. Es de SOLO-LECTURA (tests / git status / secret-scan):
  // no toca producción, así que corre SIEMPRE, incluso en dry-run. Parte de la
  // confianza que da --dry-run es saber si el gate habría bloqueado el deploy (§8).
  const gate = await deps.runGate();
  const gateReport = formatGateResults(gate);
  if (gateReport) deps.log(`Pre-flight:\n${gateReport}`);

  // --dry-run: mostrar el plan + el veredicto real del gate, y salir SIN ejecutar
  // deploy/verify/rollback (§8).
  if (deps.dryRun) {
    deps.log(deps.planText);
    if (gate.passed) {
      deps.log('🔎 Dry-run: el pre-flight gate pasa. No se ejecutó deploy/verify/rollback.');
      return { ok: true, stage: 'plan', gate, detail: 'dry-run: gate ok, no se desplegó' };
    }
    deps.log('🔎 Dry-run: el pre-flight gate BLOQUEARÍA el deploy. No se ejecutó nada más.');
    return { ok: false, stage: 'plan', gate, detail: 'dry-run: el gate bloquearía el deploy' };
  }

  // Corrida real: si el gate bloquea, frenar sin tocar producción.
  if (!gate.passed) {
    deps.log('🔴 El pre-flight gate bloqueó el deploy — no se tocó producción.');
    return { ok: false, stage: 'gate', gate };
  }

  // Mostrar el plan (informativo). Confirmar solo si el llamador lo pide.
  deps.log(deps.planText);
  if (deps.needsConfirmation) {
    const confirmed = await deps.confirm();
    if (!confirmed) {
      deps.log('Cancelado. No se desplegó nada.');
      return { ok: false, stage: 'confirm', gate, detail: 'cancelado por el usuario' };
    }
  }

  // Fase 2 — deploy.
  const deploy = await deps.deployer.deploy();
  if (!deploy.ok) {
    deps.log(`🔴 El deploy falló${deploy.detail ? `: ${deploy.detail}` : ''}.`);
    return { ok: false, stage: 'deploy', gate, deploy };
  }

  // Fase 3 — verificación real (el deployer aplica sus reintentos).
  const verify = await deps.deployer.verify(deploy);
  if (verify.ok) {
    if (verify.weak) {
      // Verificación DÉBIL: el proceso corre, pero no confirmamos que responda bien.
      // NO se persiste: el puntero de rollback NO puede avanzar a un commit no confirmado.
      // La seguridad del rollback queda garantizada por la ESTRUCTURA, no por que alguien
      // lea el aviso. Un "ok" débil no es un "ok" de verdad: hay que gritarlo.
      deps.log('');
      deps.log('⚠️  VERIFICACIÓN DÉBIL — no puedo confirmar que el servicio responde bien,');
      deps.log(`    solo que el proceso sigue corriendo${verify.detail ? ` (${verify.detail})` : ''}.`);
      deps.log('    El puntero de rollback NO avanzó: queda en el último deploy con verificación fuerte.');
      deps.log('    Configurá un endpoint /salud (healthUrl) para una verificación real.');
      deps.log('✅ Desplegado — proceso corriendo, pero SIN verificación fuerte (ver aviso ⚠️ arriba).');
    } else {
      await deps.onVerified(deploy);
      deps.log('✅ Desplegado y verificado.');
    }
    return { ok: true, stage: 'done', gate, deploy, verify };
  }

  // Verificación falló → rollback, registrando siempre si funcionó o no.
  const rollback = await deps.deployer.rollback();
  if (!rollback.attempted) {
    deps.log(`🔴 Verificación fallida y sin rollback posible${rollback.detail ? `: ${rollback.detail}` : ''}.`);
  } else if (rollback.ok) {
    deps.log('↩️  Verificación fallida — rollback completado al estado anterior.');
  } else {
    deps.log(`🔴 Verificación fallida y el rollback TAMBIÉN falló${rollback.detail ? `: ${rollback.detail}` : ''}.`);
  }
  return { ok: false, stage: 'rollback', gate, deploy, verify, rollback };
}
