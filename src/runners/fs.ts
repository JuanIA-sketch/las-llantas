/**
 * Adaptadores de filesystem reales (BORDE de I/O). La lógica que los usa (detect,
 * config, secret-scan) se testea con fakes; estos se cubren por la integración del cli.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ConfigFs } from '../core/config.js';

/** ConfigFs real: read devuelve null si el archivo no existe. */
export const realConfigFs: ConfigFs = {
  read: (path) => readFile(path, 'utf8').then((c) => c, () => null),
  write: (path, content) => writeFile(path, content, 'utf8'),
};

/** Nombres en la raíz del proyecto (archivos y carpetas), para la detección. */
export async function listEntries(cwd: string): Promise<string[]> {
  return readdir(cwd);
}

/** Lee y parsea package.json; null si falta o no parsea. */
export async function readPackageJson(cwd: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    const doc = JSON.parse(raw) as unknown;
    return doc && typeof doc === 'object' ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Carpetas que el escaneo de secretos nunca recorre (ruido / artefactos). */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.vercel']);
const MAX_FILE_BYTES = 1_000_000;

/**
 * Camina el working tree devolviendo rutas de archivo relativas a `cwd`, saltando
 * carpetas de artefactos y archivos muy grandes. Para el escaneo de secretos.
 */
export async function listTextFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(cwd, full).split(sep).join('/'));
      }
    }
  }
  await walk(cwd);
  return out;
}

/** Lee un archivo de texto relativo a `cwd`; archivos grandes se saltan (string vacío). */
export async function readTextFile(cwd: string, relPath: string): Promise<string> {
  const full = join(cwd, ...relPath.split('/'));
  try {
    const buf = await readFile(full);
    if (buf.byteLength > MAX_FILE_BYTES) return '';
    return buf.toString('utf8');
  } catch {
    return '';
  }
}
