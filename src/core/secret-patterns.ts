/**
 * VENDORIZADO de La Alarma — copiado de la-alarma@0.1.1 `src/core/secret-patterns.ts`.
 * (Revisar periódicamente si La Alarma agregó patrones nuevos que acá nos estemos
 * perdiendo; si se edita, mantener `tests/secret-patterns.test.ts` en verde.)
 *
 * Detector de secretos por patrón, reutilizable por los checkers.
 *
 * Cubre secretos con FORMA reconocible (prefijos conocidos, private keys, JWT,
 * URLs con credenciales). NO detecta secretos genéricos por entropía — decisión
 * consciente de V1.
 */

export interface PatternMatch {
  ruleId: string;
  description: string;
  // Deliberadamente SIN el valor del secreto.
}

interface SecretRule {
  ruleId: string;
  description: string;
  regex: RegExp;
}

const RULES: SecretRule[] = [
  {
    ruleId: 'private-key',
    description: 'Clave privada (PEM)',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/,
  },
  {
    ruleId: 'github-pat',
    description: 'GitHub Personal Access Token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b|\bgithub_pat_[0-9A-Za-z_]{22,}\b/,
  },
  {
    ruleId: 'telegram-bot-token',
    description: 'Token de bot de Telegram',
    regex: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/,
  },
  {
    ruleId: 'slack-token',
    description: 'Token de Slack',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/,
  },
  {
    ruleId: 'stripe-key',
    description: 'Clave secreta de Stripe',
    regex: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/,
  },
  {
    ruleId: 'aws-access-key',
    description: 'AWS Access Key ID',
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    ruleId: 'google-api-key',
    description: 'Google API Key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    ruleId: 'jwt',
    description: 'JSON Web Token',
    regex: /\beyJ[0-9A-Za-z_-]+\.eyJ[0-9A-Za-z_-]+\.[0-9A-Za-z_-]+\b/,
  },
  {
    ruleId: 'url-credentials',
    description: 'URL con credenciales embebidas',
    regex: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/i,
  },
];

/** Devuelve todos los patrones de secreto que matchea `value`. Nunca incluye el valor. */
export function detectSecrets(value: string): PatternMatch[] {
  if (!value) return [];
  const matches: PatternMatch[] = [];
  for (const rule of RULES) {
    if (rule.regex.test(value)) {
      matches.push({ ruleId: rule.ruleId, description: rule.description });
    }
  }
  return matches;
}
