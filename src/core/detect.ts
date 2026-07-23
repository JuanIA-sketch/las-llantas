/**
 * Detección del tipo de proyecto por firma de archivos (§5 del brief).
 *
 * Función pura: recibe un `probe` (qué archivos/carpetas hay en la raíz + el
 * package.json parseado) y devuelve el tipo, sin tocar el disco. El I/O de listar
 * la carpeta y leer package.json vive en el borde (config.ts / cli.ts).
 *
 * El ORDEN importa: un package.json con name+version es casi universal, así que
 * npm es la categoría RESIDUAL, probada al final y solo con señales positivas de
 * librería. Vercel y PM2 se detectan primero por su firma específica.
 */

export type ProjectType = 'vercel' | 'pm2' | 'npm';

/** Subconjunto de package.json que mira la detección. Campos `unknown`: viene de JSON sin validar. */
export interface PackageJsonLike {
  name?: unknown;
  version?: unknown;
  main?: unknown;
  exports?: unknown;
  bin?: unknown;
}

export interface DetectProbe {
  /** Nombres de archivos/carpetas en la raíz (p.ej. 'vercel.json', '.vercel', 'next.config.js'). */
  entries: string[];
  /** package.json parseado, o null si falta o no parsea. */
  packageJson: PackageJsonLike | null;
  /** `type` recordado en .llantas.json; si es un tipo válido, overridea la cascada. */
  rememberedType?: string;
}

export type DetectResult =
  | { kind: 'vercel' }
  | { kind: 'pm2' }
  | { kind: 'npm' }
  | { kind: 'needs-confirmation'; reason: 'ambiguous' | 'unknown' };

const PROJECT_TYPES: readonly ProjectType[] = ['vercel', 'pm2', 'npm'];

/** Config de framework de app cuya presencia descalifica a npm (next/vite/nuxt/svelte/astro). */
const APP_FRAMEWORK_CONFIG = /^(?:next|vite|nuxt|svelte|astro)\.config\.[cm]?[jt]s$/;

function hasVercelSignal(entries: string[]): boolean {
  return entries.includes('vercel.json') || entries.includes('.vercel');
}

function hasPm2Signal(entries: string[]): boolean {
  return entries.includes('ecosystem.config.js');
}

function hasAppFrameworkConfig(entries: string[]): boolean {
  return entries.some((e) => APP_FRAMEWORK_CONFIG.test(e));
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** name+version válidos + al menos una señal de librería (main | exports | bin). */
function looksLikeLibrary(pkg: PackageJsonLike | null): boolean {
  if (!pkg) return false;
  if (!isNonEmptyString(pkg.name) || !isNonEmptyString(pkg.version)) return false;
  return pkg.main !== undefined || pkg.exports !== undefined || pkg.bin !== undefined;
}

export function detectType(probe: DetectProbe): DetectResult {
  // Override: un `type` recordado (dejado por El Chasis al scaffoldear, o por una
  // confirmación previa) gana sobre la firma de archivos.
  if (probe.rememberedType && PROJECT_TYPES.includes(probe.rememberedType as ProjectType)) {
    return { kind: probe.rememberedType as ProjectType };
  }

  const vercel = hasVercelSignal(probe.entries);
  const pm2 = hasPm2Signal(probe.entries);

  // Señales fuertes en conflicto → no adivina (§5 paso 4).
  if (vercel && pm2) return { kind: 'needs-confirmation', reason: 'ambiguous' };
  if (vercel) return { kind: 'vercel' };
  if (pm2) return { kind: 'pm2' };

  // npm, categoría residual: exige señales de librería y que NO haya un config de
  // framework de app al lado (un Next.js sin vercel.json cae acá y NO es npm).
  if (looksLikeLibrary(probe.packageJson) && !hasAppFrameworkConfig(probe.entries)) {
    return { kind: 'npm' };
  }

  return { kind: 'needs-confirmation', reason: 'unknown' };
}
