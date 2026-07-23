/**
 * Adaptador de I/O: pega HTTP para la verificación post-deploy. Es el BORDE — usa
 * el `fetch` global (Node ≥ 20), no se testea por unidad; la lógica de reintentos
 * (retry.ts) y de verificación (deployers) se testea con un httpGet falso.
 *
 * Puede tirar si la conexión falla (DNS, ECONNREFUSED); `withRetries` en el deployer
 * lo trata como fallo reintentable, para no disparar rollback por una demora de arranque.
 */

export interface HttpResponse {
  status: number;
}

/** Timeout por request. Una verificación NUNCA debe colgarse esperando a un servicio roto. */
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * GET a `url`, devuelve el status HTTP final (sigue redirects).
 *
 * CLAVE: usa `AbortSignal.timeout`. El `fetch` de Node NO tiene timeout por default,
 * así que un endpoint que acepta la conexión pero nunca responde (ej. un /salud de una
 * versión rota) colgaría el verify PARA SIEMPRE — y como `withRetries` solo reacciona a
 * un resultado o a un throw, una promesa que nunca resuelve congela el loop sin retry ni
 * rollback. Con el timeout, un endpoint colgado LANZA → se trata como fallo reintentable
 * → tras los reintentos, verify falla → se dispara el rollback.
 */
export async function httpGet(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<HttpResponse> {
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
  return { status: res.status };
}
