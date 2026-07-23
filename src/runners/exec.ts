/**
 * Adaptador de I/O: corre procesos reales (git, npm, vercel). Es el BORDE — no se
 * testea por unidad (como remote-runner.ts / gitleaks/runner.ts de La Alarma); la
 * lógica que lo usa (deployer, gate runners) se testea con fakes de estas mismas
 * firmas, y estos adaptadores se cubren por integración/e2e.
 *
 * Nunca rechaza por exit code ≠ 0: devuelve el `code` para que la capa de arriba
 * decida. Solo propaga si el binario no se pudo lanzar (ENOENT) — ahí la traducción
 * a lenguaje simple la hace errors.ts/cli.ts.
 */

import { execFile, spawn } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
}

/** true si el error es "no se pudo lanzar el binario" (binario ausente). */
function isSpawnFailure(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { syscall?: string };
  return typeof e?.code === 'string' && typeof e.syscall === 'string' && e.syscall.startsWith('spawn');
}

/** Solo tokens simples: letras, dígitos y `-_@:./\+=~,`. Sin espacios ni metacaracteres de shell. */
const SAFE_ARG = /^[\w@:./\\+=~,-]*$/;

/**
 * true si `arg` es un token seguro para pasar al shell. Con shell:true (necesario en
 * Windows para resolver npm.cmd/vercel.cmd), Node NO escapa los argumentos: los
 * concatena en la línea del shell tal cual. Esta barrera impide que un valor externo
 * (nombre de paquete, versión, SHA, URL) se vuelva un comando aparte vía `&`, `;`, `|`…
 */
export function isShellSafeArg(arg: string): boolean {
  return SAFE_ARG.test(arg);
}

/** Valida command + args antes de ejecutar; lanza si algo no es un token seguro. */
function assertShellSafe(command: string, args: string[]): void {
  for (const value of [command, ...args]) {
    if (!isShellSafeArg(value)) {
      throw new Error(
        `Argumento no seguro para exec (posible inyección de comandos en el shell): ${JSON.stringify(value)}. ` +
          'Los argumentos deben ser tokens simples, sin espacios ni metacaracteres de shell.',
      );
    }
  }
}

/**
 * Corre `command args...`. En Windows usa shell para resolver .cmd (npm.cmd, vercel.cmd).
 * `async` a propósito: la validación de seguridad (`assertShellSafe`) rechaza vía
 * promesa, nunca con un throw síncrono que el llamador podría olvidar de atrapar.
 */
export async function runCommand(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  assertShellSafe(command, args);
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: options.cwd, shell: process.platform === 'win32', maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && isSpawnFailure(error)) {
          reject(error);
          return;
        }
        // Salida normal (incluye exit ≠ 0): execFile pone el exit code en error.code (número).
        const code = error && typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/**
 * Corre `command args...` HEREDANDO el stdio real del proceso (stdin/stdout/stderr
 * conectados a la terminal de la persona), en vez de capturarlo en pipes como
 * runCommand. Se usa para `npm publish`: hay cuentas de npm que exigen una
 * confirmación interactiva (navegador/OTP) en CADA publish, no solo en el login. Si
 * ese prompt cae en un pipe capturado, no le llega a nadie y npm se cuelga o falla
 * genérico. Heredando stdio, la confirmación aparece en la terminal y la persona la
 * responde en el momento — igual que el prompt propio de Las Llantas.
 *
 * No devuelve stdout (va directo a la terminal, no se captura); la verificación
 * post-publish se hace aparte con `npm view`. Mantiene la MISMA barrera de inyección
 * que runCommand (assertShellSafe), porque también usa shell en Windows.
 */
export async function runCommandInheritStdio(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<{ code: number }> {
  assertShellSafe(command, args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    child.on('error', (err) => {
      // El binario no se pudo lanzar (ENOENT, etc.): la traducción a lenguaje simple
      // la hace errors.ts/cli.ts, igual que en runCommand.
      reject(err);
    });
    child.on('close', (code) => {
      // Salida normal (incluye exit ≠ 0): la capa de arriba decide según el code.
      resolve({ code: code ?? 0 });
    });
  });
}

/** Runner de `npm publish` atado a un cwd, con stdio heredado (matchea CliDeps.runPublish). */
export const nodeRunPublish = async (cwd: string): Promise<{ code: number }> => {
  return runCommandInheritStdio('npm', ['publish'], { cwd });
};

/** Runner de comandos genérico (matchea RunTestsDeps.runCommand). */
export const nodeRunCommand = async (cwd: string, command: string, args: string[]): Promise<{ code: number }> => {
  const { code } = await runCommand(command, args, { cwd });
  return { code };
};

/** Runner de comandos que devuelve stdout (para `npm view` / `npm publish`). */
export const nodeRunCommandOut = async (
  cwd: string,
  command: string,
  args: string[],
): Promise<{ code: number; stdout: string }> => {
  const { code, stdout } = await runCommand(command, args, { cwd });
  return { code, stdout };
};

/** Runner de git (matchea GitStatusDeps.runGit). */
export const gitRunner = async (cwd: string, args: string[]): Promise<{ code: number; stdout: string }> => {
  const { code, stdout } = await runCommand('git', args, { cwd });
  return { code, stdout };
};

/** Runner de la CLI de Vercel, atado a un cwd (matchea VercelDeployerDeps.runVercel). */
export const vercelRunner = (cwd: string) => async (args: string[]): Promise<{ code: number; stdout: string }> => {
  const { code, stdout } = await runCommand('vercel', args, { cwd });
  return { code, stdout };
};
