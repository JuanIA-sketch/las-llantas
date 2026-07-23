/**
 * VENDORIZADO de La Alarma — copiado de la-alarma@0.1.1 `tests/support/synthetic-secrets.ts`.
 *
 * Hogar ÚNICO de literales de secretos sintéticos para los tests.
 *
 * REGLA: ningún `*.test.ts` debe contener literales de secreto inline — siempre se
 * importan desde acá. Todos son inventados (forma real, valor falso).
 *
 * Los valores se arman por concatenación A PROPÓSITO: en runtime tienen la forma
 * exacta de un secreto real (los detectores los reconocen cuando los tests los
 * escriben en archivos temporales o los pasan como datos), pero el archivo en reposo
 * no contiene ningún literal contiguo con esa forma — así el push protection de
 * GitHub no bloquea este repo ni los forks de quien lo clone.
 */

const secret = (...parts: string[]): string => parts.join('');

export const SYNTHETIC_SECRETS: Record<string, string> = {
  'github-pat': secret('ghp_', 'abcdefghij0123456789', 'ABCDEFGHIJ012345'),
  'telegram-bot-token': secret('123456789', ':AAF-abcd', 'EFGHijklMNOPqrstUVWXyz01234'),
  'slack-token': secret('xoxb-', '1234567890-', '1234567890-', 'abcdEFGHijklMNOPqrstUVWX'),
  'stripe-key': secret('sk_', 'test_', 'abcdEFGHijklMNOPqrstUVWX'),
  'aws-access-key': secret('AKIA', 'ABCDEFGHIJ123456'),
  'google-api-key': secret('AIza', 'AbCdEfGhIjKlMnOpQrStUvWxYz012345678'),
  'private-key': secret('-----BEGIN RSA ', 'PRIVATE KEY-----'),
  'jwt': secret('eyJhbGciOiJIUzI1NiJ9', '.eyJzdWIiOiIxMjM0NTY3ODkwIn0', '.abc123def456'),
  'url-credentials': secret('https://', 'admin:s3cr3tP4ss@', 'db.internal.example.com/prod'),
};

/** Token sintético con forma de GitHub PAT, reutilizado por varios tests. */
export const SYNTHETIC_TOKEN = SYNTHETIC_SECRETS['github-pat'];
