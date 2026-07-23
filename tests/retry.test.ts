import { describe, it, expect } from 'vitest';
import { withRetries } from '../src/core/retry.js';

/** sleep falso que cuenta llamadas sin esperar de verdad. */
function fakeSleep() {
  const calls: number[] = [];
  return { sleep: async (ms: number) => { calls.push(ms); }, calls };
}

const isOk = (r: { ok: boolean }) => r.ok;

describe('withRetries — verificación con reintentos (§6)', () => {
  it('devuelve al primer intento si ya está ok, sin esperar', async () => {
    const { sleep, calls } = fakeSleep();
    let attempts = 0;
    const result = await withRetries(
      async () => { attempts++; return { ok: true }; },
      { attempts: 3, delayMs: 500, isOk, sleep },
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(1);
    expect(calls).toEqual([]); // no esperó
  });

  it('reintenta hasta que da ok y devuelve ese resultado', async () => {
    const { sleep, calls } = fakeSleep();
    let attempts = 0;
    const result = await withRetries(
      async () => { attempts++; return { ok: attempts === 3, status: attempts }; },
      { attempts: 5, delayMs: 200, isOk, sleep },
    );
    expect(result).toEqual({ ok: true, status: 3 });
    expect(attempts).toBe(3);
    expect(calls).toEqual([200, 200]); // esperó entre los 2 primeros fallos
  });

  it('agota los intentos y devuelve el último resultado no-ok (no espera tras el último)', async () => {
    const { sleep, calls } = fakeSleep();
    let attempts = 0;
    const result = await withRetries(
      async () => { attempts++; return { ok: false, status: 503 }; },
      { attempts: 3, delayMs: 100, isOk, sleep },
    );
    expect(result).toEqual({ ok: false, status: 503 });
    expect(attempts).toBe(3);
    expect(calls).toEqual([100, 100]); // 2 esperas para 3 intentos
  });

  it('un throw se trata como fallo reintentable; si luego da ok, se recupera', async () => {
    const { sleep } = fakeSleep();
    let attempts = 0;
    const result = await withRetries(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error('ECONNREFUSED');
        return { ok: true };
      },
      { attempts: 3, delayMs: 10, isOk, sleep },
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('si el último intento tira, propaga el error', async () => {
    const { sleep } = fakeSleep();
    await expect(
      withRetries(
        async () => { throw new Error('sigue caído'); },
        { attempts: 2, delayMs: 10, isOk, sleep },
      ),
    ).rejects.toThrow('sigue caído');
  });
});
