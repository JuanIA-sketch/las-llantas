/**
 * Persistencia de estado de Las Llantas, en DOS archivos por ciclo de vida distinto:
 *
 * - `.llantas.json` (COMMITEADO, seguro de commitear): config que se fija una vez —
 *   type, npmIdentityConfirmed, vercelDeployedOnce (flag set-once), healthUrl. No
 *   cambia deploy a deploy, así que no ensucia el working tree.
 * - `.llantas.state.json` (GITIGNOREADO): estado MUTABLE que cambia en cada deploy —
 *   `lastGoodCommit` (pm2). Si viviera en el archivo commiteado, cada deploy exitoso
 *   dejaría el árbol sucio y el `git-clean` del siguiente deploy fallaría.
 *
 * `buildDetectProbe` le pasa `rememberedType` a `detectType`, de modo que detect.ts
 * se mantiene puro (nunca lee el archivo por dentro). El I/O (fs) se inyecta.
 */

import type { DetectProbe, PackageJsonLike, ProjectType } from './detect.js';

export const SCHEMA_VERSION = 1;

/** Config commiteable (`.llantas.json`): valores que se fijan una vez. */
export interface LlantasConfig {
  schema?: number;
  /** Tipo recordado (respuesta de detección/confirmación, o dejado por El Chasis). */
  type?: ProjectType;
  /** Solo npm: identidad confirmada una vez antes de habilitar publish. */
  npmIdentityConfirmed?: boolean;
  /** Solo vercel: false/ausente hasta el primer deploy exitoso (señal de "primera corrida"). */
  vercelDeployedOnce?: boolean;
  /** Solo pm2 (opcional): URL del endpoint /salud. Si falta, la verificación cae al fallback de estado PM2. */
  healthUrl?: string;
}

/** Estado mutable gitignoreado (`.llantas.state.json`): cambia en cada deploy. */
export interface LlantasState {
  schema?: number;
  /** Solo pm2: último commit que pasó verificación (objetivo del rollback + señal de "primera corrida"). */
  lastGoodCommit?: string;
}

/** Nombre del archivo de estado mutable, gitignoreado. */
export const STATE_FILENAME = '.llantas.state.json';

/** I/O de persistencia del config (inyectable). `read` devuelve null si el archivo no existe. */
export interface ConfigFs {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
}

/** Parsea el contenido de `.llantas.json`. Contenido inválido/vacío → config vacío. */
export function parseConfig(text: string): LlantasConfig {
  try {
    const doc = JSON.parse(text) as unknown;
    return doc && typeof doc === 'object' ? (doc as LlantasConfig) : {};
  } catch {
    return {};
  }
}

/** Lee y parsea `.llantas.json`. Archivo ausente → config vacío. */
export async function loadConfig(path: string, fs: ConfigFs): Promise<LlantasConfig> {
  const content = await fs.read(path);
  return content == null ? {} : parseConfig(content);
}

/** Escribe el config como JSON legible. */
export async function saveConfig(path: string, config: LlantasConfig, fs: ConfigFs): Promise<void> {
  await fs.write(path, JSON.stringify(config, null, 2) + '\n');
}

/** Merge puro de un patch sobre el config actual, asegurando el schema. Base del "cuándo se actualiza". */
export function updateConfig(current: LlantasConfig, patch: Partial<LlantasConfig>): LlantasConfig {
  return { schema: SCHEMA_VERSION, ...current, ...patch };
}

/** Lee y parsea `.llantas.state.json`. Archivo ausente / inválido → estado vacío. */
export async function loadState(path: string, fs: ConfigFs): Promise<LlantasState> {
  const content = await fs.read(path);
  if (content == null) return {};
  try {
    const doc = JSON.parse(content) as unknown;
    return doc && typeof doc === 'object' ? (doc as LlantasState) : {};
  } catch {
    return {};
  }
}

/** Escribe el estado mutable como JSON legible. */
export async function saveState(path: string, state: LlantasState, fs: ConfigFs): Promise<void> {
  await fs.write(path, JSON.stringify(state, null, 2) + '\n');
}

/** Merge puro de un patch sobre el estado actual, asegurando el schema. */
export function updateState(current: LlantasState, patch: Partial<LlantasState>): LlantasState {
  return { schema: SCHEMA_VERSION, ...current, ...patch };
}

/** I/O para armar el probe (inyectable). */
export interface ProbeFs {
  /** Nombres de archivos/carpetas en la raíz del proyecto. */
  listEntries(cwd: string): Promise<string[]>;
  /** package.json parseado, o null si falta / no parsea. */
  readPackageJson(cwd: string): Promise<PackageJsonLike | null>;
}

/**
 * Arma el `DetectProbe` desde disco, inyectando `config.type` como `rememberedType`
 * para que `detectType` (puro) lo respete sin leer el archivo por su cuenta.
 */
export async function buildDetectProbe(
  cwd: string,
  config: LlantasConfig,
  fs: ProbeFs,
): Promise<DetectProbe> {
  const [entries, packageJson] = await Promise.all([fs.listEntries(cwd), fs.readPackageJson(cwd)]);
  return { entries, packageJson, rememberedType: config.type };
}
