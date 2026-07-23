import { describe, it, expect } from 'vitest';
import { friendlyError } from '../src/core/errors.js';

describe('friendlyError — traduce errores crudos a lenguaje simple (§8)', () => {
  it('ECONNREFUSED → habla de conexión, no del código crudo', () => {
    const msg = friendlyError(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:22'), { code: 'ECONNREFUSED' }));
    expect(msg).toMatch(/conect/i);
    expect(msg).not.toMatch(/ECONNREFUSED/);
  });

  it('ENOENT de spawn (binario ausente) → habla de comando no encontrado / PATH', () => {
    const err = Object.assign(new Error('spawn vercel ENOENT'), { code: 'ENOENT', syscall: 'spawn vercel' });
    const msg = friendlyError(err);
    expect(msg).toMatch(/comando|instalad|PATH/i);
    expect(msg).not.toMatch(/ENOENT/);
  });

  it('DNS (ENOTFOUND) → habla de no encontrar el host', () => {
    const msg = friendlyError(Object.assign(new Error('getaddrinfo ENOTFOUND foo'), { code: 'ENOTFOUND' }));
    expect(msg).toMatch(/host|direcci|encontr/i);
  });

  it('un mensaje ya legible se devuelve tal cual', () => {
    expect(friendlyError(new Error('Los tests fallaron'))).toBe('Los tests fallaron');
  });

  it('un valor no-Error se convierte a texto sin romper', () => {
    expect(typeof friendlyError('algo raro')).toBe('string');
  });
});
