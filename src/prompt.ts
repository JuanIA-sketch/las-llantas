/**
 * Prompts interactivos (patrón de La Alarma `init/prompt.ts`). Boundary fino sobre
 * node:readline/promises: la lógica que lo usa (cli) se testea con un prompt guionado.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export interface Prompt {
  ask(question: string): Promise<string>;
  confirm(question: string): Promise<boolean>;
}

export function createReadlinePrompt(): Prompt & { close(): void } {
  const rl = createInterface({ input: stdin, output: stdout });
  return {
    async ask(question) {
      return (await rl.question(`${question} `)).trim();
    },
    async confirm(question) {
      const answer = (await rl.question(`${question} (s/N) `)).trim();
      return /^(s|si|sí|y|yes)$/i.test(answer);
    },
    close: () => rl.close(),
  };
}
