import { describe, it, expect } from 'vitest';
import { isSafeSshTarget } from '../src/runners/ssh.js';

// El target va como argv a ssh SIN shell local, pero validamos igual para que un
// valor tipo "-oProxyCommand=..." no se cuele como opción de ssh (inyección clásica).
describe('isSafeSshTarget', () => {
  it('acepta user@host y alias simples', () => {
    for (const t of ['deploy@srv.example.com', 'user@1.2.3.4', 'miservidor', 'root@vps-01']) {
      expect(isSafeSshTarget(t), t).toBe(true);
    }
  });

  it('rechaza targets que empiezan con guion (posible opción de ssh) o con metacaracteres', () => {
    for (const t of ['-oProxyCommand=calc', '-Fnone', 'a; rm -rf /', 'user@host && x', 'con espacio', '']) {
      expect(isSafeSshTarget(t), t).toBe(false);
    }
  });
});
