/**
 * Reintentos con espera corta, usados por la verificación post-deploy (§6): no
 * declarar fallo (ni disparar rollback) solo porque el servicio tardó unos
 * segundos en quedar listo. Genérico y con `sleep` inyectable para tests.
 */

export interface RetryOptions<T> {
  /** Intentos totales (>= 1). */
  attempts: number;
  /** Espera entre intentos, en ms. No se espera después del último. */
  delayMs: number;
  /** Predicado de éxito sobre el resultado de `fn`. */
  isOk: (result: T) => boolean;
  /** Espera inyectable (default: setTimeout real). */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Corre `fn` hasta que `isOk` sea true o se agoten los intentos. Un throw se trata
 * como fallo reintentable. Devuelve el último resultado; si el ÚLTIMO intento tiró,
 * propaga ese error (no hubo resultado que devolver).
 */
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions<T>,
): Promise<T> {
  const sleep = options.sleep ?? realSleep;
  let lastResult: T | undefined;
  let lastError: unknown;
  let lastThrew = false;

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      const result = await fn(attempt);
      lastResult = result;
      lastThrew = false;
      if (options.isOk(result)) return result;
    } catch (err) {
      lastError = err;
      lastThrew = true;
    }
    if (attempt < options.attempts) await sleep(options.delayMs);
  }

  if (lastThrew) throw lastError;
  return lastResult as T;
}
