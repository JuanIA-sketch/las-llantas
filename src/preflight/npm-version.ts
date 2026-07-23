/**
 * Chequeos de versión del gate npm (§6) — el pre-flight MÁS estricto, porque npm no
 * tiene vuelta atrás:
 *  - version-bumped: la versión local debe ser MAYOR que la publicada.
 *  - version-not-duplicate: bloquea si se está por republicar la misma versión.
 *
 * Comparador semver propio (sin dependencias): compara release numéricamente y trata
 * una versión con prerelease como menor que la misma sin prerelease.
 */

import type { GateCheckOutcome } from '../core/gate.js';

/** Resultado de mirar el registro: si el paquete está publicado y con qué versión. */
export type RegistryLookup = () => Promise<{ published: boolean; version: string }>;

interface Parsed {
  release: number[];
  prerelease: string[];
}

function parse(version: string): Parsed {
  const [core] = version.trim().split('+'); // descarta build metadata
  const [rel, pre] = core.split('-');
  const release = rel.split('.').map((n) => Number(n) || 0);
  const prerelease = pre ? pre.split('.') : [];
  return { release, prerelease };
}

function compareIdentifiers(a: string, b: string): number {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Number(a) - Number(b) === 0 ? 0 : Number(a) < Number(b) ? -1 : 1;
  if (an) return -1; // numérico < alfanumérico (regla semver)
  if (bn) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** -1 si a<b, 0 si iguales, 1 si a>b. */
export function compareSemver(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);

  const len = Math.max(pa.release.length, pb.release.length);
  for (let i = 0; i < len; i++) {
    const x = pa.release[i] ?? 0;
    const y = pb.release[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }

  // Release igual: sin prerelease > con prerelease.
  if (pa.prerelease.length === 0 && pb.prerelease.length === 0) return 0;
  if (pa.prerelease.length === 0) return 1;
  if (pb.prerelease.length === 0) return -1;

  const plen = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < plen; i++) {
    const x = pa.prerelease[i];
    const y = pb.prerelease[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const c = compareIdentifiers(x, y);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

export async function checkVersionBumped(localVersion: string, lookup: RegistryLookup): Promise<GateCheckOutcome> {
  const reg = await lookup();
  if (!reg.published) return { ok: true, detail: 'primer publish: no hay versión previa en el registro' };
  if (compareSemver(localVersion, reg.version) > 0) return { ok: true };
  return {
    ok: false,
    detail: `la versión local ${localVersion} no es mayor que la publicada ${reg.version} — subí la versión en package.json antes de publicar`,
  };
}

export async function checkVersionNotDuplicate(
  localVersion: string,
  lookup: RegistryLookup,
): Promise<GateCheckOutcome> {
  const reg = await lookup();
  if (!reg.published) return { ok: true };
  if (localVersion === reg.version) {
    return { ok: false, detail: `la versión ${localVersion} ya está publicada en npm — estarías republicando la misma` };
  }
  return { ok: true };
}
