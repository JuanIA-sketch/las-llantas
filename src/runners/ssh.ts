/**
 * Adaptador SSH (BORDE de I/O). Corre un comando en el server vía la sesión SSH
 * que la persona ya tiene configurada (Las Llantas nunca gestiona la llave).
 *
 * Clave de seguridad: usa execFile SIN shell local. El comando remoto (que lleva
 * espacios y `&&`) va como UN solo argv a `ssh` y lo interpreta el shell del SERVER,
 * no el local — así no hay inyección local ni el `&&` se ejecuta en la máquina de acá.
 * El target se valida igual, para que no se cuele como una opción de ssh (`-o…`).
 */

import { execFile } from 'node:child_process';

/** Target seguro: user@host o alias, sin guion inicial ni metacaracteres. */
const SAFE_TARGET = /^[A-Za-z0-9._@-]+$/;

export function isSafeSshTarget(target: string): boolean {
  return target.length > 0 && !target.startsWith('-') && SAFE_TARGET.test(target);
}

/** Devuelve un runner atado a `target` que corre comandos remotos por SSH. */
export function sshRunner(target: string): (command: string) => Promise<{ code: number; stdout: string }> {
  if (!isSafeSshTarget(target)) {
    throw new Error(`Target SSH no válido: ${JSON.stringify(target)}. Esperaba algo como user@host.`);
  }
  return (command: string) =>
    new Promise((resolve, reject) => {
      // Sin shell: [target, command] van literales a ssh; el server ejecuta `command`.
      execFile('ssh', [target, command], { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
        const e = error as { code?: unknown; syscall?: unknown } | null;
        if (e && typeof e.code === 'string' && typeof e.syscall === 'string' && e.syscall.startsWith('spawn')) {
          reject(error); // ssh no está instalado / no se pudo lanzar
          return;
        }
        const code = e && typeof e.code === 'number' ? e.code : 0;
        resolve({ code, stdout: String(stdout) });
      });
    });
}
