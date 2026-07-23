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

/** GET a `url`, devuelve el status HTTP final (sigue redirects). */
export async function httpGet(url: string): Promise<HttpResponse> {
  const res = await fetch(url, { method: 'GET' });
  return { status: res.status };
}
