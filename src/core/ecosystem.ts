/**
 * Lee la configuración de despliegue del `ecosystem.config.js` de PM2 (§6): de ahí
 * salen el target SSH, el directorio remoto, el nombre del proceso y la rama — así
 * Las Llantas NO almacena esos datos de infra en su propio config.
 *
 * Función pura: recibe el módulo ya cargado (el import() lo hace el borde) y extrae
 * los campos. Devuelve un error legible si falta algo, en vez de romper con jerga.
 */

export interface Pm2Settings {
  sshTarget: string;
  remoteDir: string;
  processName: string;
  branch: string;
}

export type ExtractResult = { ok: true; settings: Pm2Settings } | { ok: false; error: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export function extractPm2Settings(mod: unknown): ExtractResult {
  // Un import() de un ecosystem CJS deja el module.exports bajo `.default`.
  const outer = asRecord(mod);
  const root = asRecord(outer?.default) ?? outer;
  if (!root) return { ok: false, error: 'El ecosystem.config.js está vacío o no es un objeto.' };

  const apps = root.apps;
  const firstApp = Array.isArray(apps) ? asRecord(apps[0]) : null;
  const name = firstApp?.name;
  if (typeof name !== 'string' || name === '') {
    return { ok: false, error: 'No encontré apps[0].name en ecosystem.config.js.' };
  }

  const deploy = asRecord(root.deploy);
  const env = asRecord(deploy?.production) ?? (deploy ? asRecord(Object.values(deploy)[0]) : null);
  if (!env) {
    return { ok: false, error: 'No encontré el bloque `deploy` en ecosystem.config.js (¿configuraste el deploy de PM2?).' };
  }

  const user = env.user;
  const hostRaw = env.host;
  const host = Array.isArray(hostRaw) ? hostRaw[0] : hostRaw;
  const path = env.path;
  if (typeof user !== 'string' || typeof host !== 'string' || typeof path !== 'string') {
    return { ok: false, error: 'El bloque `deploy` necesita user, host y path.' };
  }

  const ref = typeof env.ref === 'string' ? env.ref : 'origin/main';
  const branch = ref.replace(/^origin\//, '');

  return { ok: true, settings: { sshTarget: `${user}@${host}`, remoteDir: path, processName: name, branch } };
}
