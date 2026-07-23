import { describe, it, expect } from 'vitest';
import { isShellSafeArg, runCommand, runCommandInheritStdio } from '../src/runners/exec.js';

// Guardia contra inyección de comandos: con shell:true (necesario en Windows para
// resolver npm.cmd/vercel.cmd), Node concatena los args en la línea del shell SIN
// escaparlos. Esta barrera garantiza que un valor externo (nombre de paquete,
// versión, SHA, URL) nunca pueda romper el límite del argumento.
describe('isShellSafeArg — barrera contra inyección de comandos', () => {
  it('acepta los tokens simples que usan los deployers/checkers', () => {
    const safe = [
      '--prod', 'status', '--porcelain', 'test', 'view', 'rollback', '--yes',
      '@scope/mi-paquete', 'las-llantas', '1.2.3-beta.1', 'a1b2c3d4', '--report-format',
    ];
    for (const arg of safe) {
      expect(isShellSafeArg(arg), arg).toBe(true);
    }
  });

  it('rechaza valores con espacio, & o ; (no pueden volverse un comando aparte)', () => {
    const dangerous = [
      'ok & echo INJECTED',
      'v; rm -rf /',
      'a | b',
      '$(whoami)',
      '`id`',
      'dos palabras',
      'x > out.txt',
      'a&&b',
    ];
    for (const arg of dangerous) {
      expect(isShellSafeArg(arg), arg).toBe(false);
    }
  });
});

describe('runCommand — no ejecuta un argumento inyectado como comando separado', () => {
  it('un arg con metacaracteres de shell hace throw ANTES de lanzar el proceso', async () => {
    await expect(runCommand('echo', ['ok & echo INJECTED'])).rejects.toThrow(
      /inyecci|no permitid|shell|seguro/i,
    );
  });
});

// `npm publish` corre con stdio HEREDADO (stdin/stdout/stderr conectados a la terminal
// real) para que una confirmación interactiva de npm le llegue a la persona. Ese runner
// no captura salida, pero mantiene la MISMA barrera de inyección que runCommand.
describe('runCommandInheritStdio — hereda stdio pero mantiene la barrera de inyección', () => {
  it('un arg con metacaracteres de shell hace throw ANTES de lanzar el proceso', async () => {
    await expect(runCommandInheritStdio('echo', ['ok & echo INJECTED'])).rejects.toThrow(
      /inyecci|no permitid|shell|seguro/i,
    );
  });
});
