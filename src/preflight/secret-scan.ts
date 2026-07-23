/**
 * Escaneo de secretos del pre-flight (§6): reusa `detectSecrets` de La Alarma
 * (vendorizado) sobre el WORKING TREE, línea por línea, para reportar archivo +
 * línea. Por diseño nunca captura el valor crudo del secreto — solo su ubicación
 * y la regla que lo detectó (mismo criterio que el reporter de La Alarma).
 */

import { detectSecrets } from '../core/secret-patterns.js';

/** Un archivo ya leído, listo para escanear. */
export interface ScanFile {
  /** Ruta a mostrar en el hallazgo (relativa a la raíz del proyecto). */
  path: string;
  content: string;
}

/** Hallazgo de secreto: ubicación + regla, NUNCA el valor. */
export interface SecretFinding {
  rule: string;
  description: string;
  file: string;
  /** 1-indexed. */
  line: number;
}

/**
 * Escanea contenidos ya leídos, línea por línea. Función pura: no toca disco.
 * Un hallazgo por cada (archivo, línea, regla que matchea).
 */
export function scanFiles(files: ScanFile[]): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { path, content } of files) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const match of detectSecrets(lines[i])) {
        findings.push({
          rule: match.ruleId,
          description: match.description,
          file: path,
          line: i + 1,
        });
      }
    }
  }
  return findings;
}

/** Dependencias de I/O del escaneo del working tree (inyectables; los tests las falsean). */
export interface ScanFsDeps {
  /** Rutas de archivos de texto a escanear, relativas a `cwd` (ya filtradas: sin node_modules/.git/dist). */
  listFiles: (cwd: string) => Promise<string[]>;
  /** Lee el contenido de una ruta relativa a `cwd`. */
  readFile: (cwd: string, relPath: string) => Promise<string>;
}

/**
 * Escanea el working tree de `cwd`: lista los archivos, los lee vía las deps
 * inyectadas y delega en `scanFiles`. El I/O real (fs) se conecta en el borde.
 */
export async function scanWorkingTree(cwd: string, deps: ScanFsDeps): Promise<SecretFinding[]> {
  const relPaths = await deps.listFiles(cwd);
  const files: ScanFile[] = await Promise.all(
    relPaths.map(async (relPath) => ({ path: relPath, content: await deps.readFile(cwd, relPath) })),
  );
  return scanFiles(files);
}
