/**
 * Tipos compartidos del deploy. El `Deployer` es la interfaz común a los 3 tipos
 * (vercel/pm2/npm) que el orquestador (pipeline.ts) consume: cada tipo la implementa
 * a su manera, pero el pipeline solo ve estas tres fases.
 */

export interface DeployOutcome {
  ok: boolean;
  /** URL de producción (vercel) u otra referencia del deploy, si aplica. */
  url?: string;
  /** Commit desplegado (pm2): lo persiste `onVerified` como lastGoodCommit tras verificar. */
  commit?: string;
  detail?: string;
}

export interface VerifyResult {
  ok: boolean;
  status?: number;
  /** Qué se verificó (URL con healthPath, endpoint, versión…). */
  url?: string;
  detail?: string;
  /**
   * true si la verificación fue DÉBIL: confirma que el proceso corre, pero NO que
   * responda bien (ej. fallback de estado PM2 sin /salud). El pipeline lo muestra
   * como advertencia prominente — un "ok" débil no es un "ok" de verdad.
   */
  weak?: boolean;
}

export interface RollbackResult {
  /** false si no había a dónde volver (primer deploy) o si el tipo no soporta rollback (npm). */
  attempted: boolean;
  ok: boolean;
  detail?: string;
}

/** Interfaz común de las 3 fases de despliegue. La comparten vercel/pm2/npm. */
export interface Deployer {
  deploy(): Promise<DeployOutcome>;
  /** Verifica lo desplegado (recibe el resultado del deploy, ej. la URL). */
  verify(deploy: DeployOutcome): Promise<VerifyResult>;
  rollback(): Promise<RollbackResult>;
}
