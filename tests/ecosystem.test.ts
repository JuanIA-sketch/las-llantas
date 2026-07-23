import { describe, it, expect } from 'vitest';
import { extractPm2Settings } from '../src/core/ecosystem.js';

const full = {
  apps: [{ name: 'demo', script: 'index.js' }],
  deploy: { production: { user: 'deploy', host: 'srv.example.com', path: '/var/www/demo', ref: 'origin/main' } },
};

describe('extractPm2Settings — lee el bloque deploy del ecosystem.config.js', () => {
  it('extrae sshTarget, remoteDir, processName y branch', () => {
    expect(extractPm2Settings(full)).toEqual({
      ok: true,
      settings: { sshTarget: 'deploy@srv.example.com', remoteDir: '/var/www/demo', processName: 'demo', branch: 'main' },
    });
  });

  it('desenvuelve module.exports bajo .default (CJS importado con import())', () => {
    expect(extractPm2Settings({ default: full })).toMatchObject({ ok: true });
  });

  it('host como array → toma el primero', () => {
    const r = extractPm2Settings({
      ...full,
      deploy: { production: { ...full.deploy.production, host: ['a.com', 'b.com'] } },
    });
    expect(r.ok && r.settings.sshTarget).toBe('deploy@a.com');
  });

  it('sin ref → branch "main" por defecto', () => {
    const r = extractPm2Settings({ apps: full.apps, deploy: { production: { user: 'd', host: 'h', path: '/p' } } });
    expect(r).toMatchObject({ ok: true, settings: { branch: 'main' } });
  });

  it('sin bloque deploy → error claro', () => {
    expect(extractPm2Settings({ apps: full.apps })).toMatchObject({ ok: false });
  });

  it('sin apps[0].name → error claro', () => {
    expect(extractPm2Settings({ deploy: full.deploy })).toMatchObject({ ok: false });
  });

  it('bloque deploy incompleto (falta path) → error claro', () => {
    const r = extractPm2Settings({ apps: full.apps, deploy: { production: { user: 'd', host: 'h' } } });
    expect(r).toMatchObject({ ok: false });
  });
});
