import { describe, it, expect } from 'vitest';
import {
  parseConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  loadState,
  saveState,
  updateState,
  buildDetectProbe,
  type ConfigFs,
  type ProbeFs,
} from '../src/core/config.js';

describe('parseConfig / loadConfig', () => {
  it('parsea JSON válido a config tipada', () => {
    expect(parseConfig('{"type":"vercel","vercelDeployedOnce":true}')).toEqual({
      type: 'vercel',
      vercelDeployedOnce: true,
    });
  });

  it('JSON inválido o vacío → config vacío (no explota)', () => {
    expect(parseConfig('no soy json')).toEqual({});
    expect(parseConfig('')).toEqual({});
    expect(parseConfig('null')).toEqual({});
  });

  it('archivo ausente (read → null) → config vacío', async () => {
    const fs: ConfigFs = { read: async () => null, write: async () => {} };
    expect(await loadConfig('/x/.llantas.json', fs)).toEqual({});
  });

  it('archivo presente → parseado', async () => {
    const fs: ConfigFs = { read: async () => '{"type":"pm2","vercelDeployedOnce":true}', write: async () => {} };
    expect(await loadConfig('/x/.llantas.json', fs)).toEqual({ type: 'pm2', vercelDeployedOnce: true });
  });
});

describe('saveConfig / updateConfig', () => {
  it('saveConfig escribe JSON que round-trippea', async () => {
    let written = '';
    const fs: ConfigFs = { read: async () => null, write: async (_p, c) => { written = c; } };
    await saveConfig('/x/.llantas.json', { type: 'npm', npmIdentityConfirmed: true }, fs);
    expect(JSON.parse(written)).toEqual({ type: 'npm', npmIdentityConfirmed: true });
  });

  it('updateConfig hace merge sin pisar otros campos y marca el schema', () => {
    const current = { schema: 1, type: 'pm2' as const, npmIdentityConfirmed: true };
    const next = updateConfig(current, { vercelDeployedOnce: true });
    expect(next).toEqual({ schema: 1, type: 'pm2', npmIdentityConfirmed: true, vercelDeployedOnce: true });
  });

  it('updateConfig sobre config vacío setea el schema', () => {
    expect(updateConfig({}, { type: 'vercel' })).toMatchObject({ schema: 1, type: 'vercel' });
  });
});

describe('estado mutable (.llantas.state.json) — separado del config commiteado', () => {
  it('loadState: archivo ausente → estado vacío', async () => {
    const fs: ConfigFs = { read: async () => null, write: async () => {} };
    expect(await loadState('/x/.llantas.state.json', fs)).toEqual({});
  });

  it('loadState: archivo presente → parseado con lastGoodCommit', async () => {
    const fs: ConfigFs = { read: async () => '{"lastGoodCommit":"a1b2c3d4"}', write: async () => {} };
    expect(await loadState('/x/.llantas.state.json', fs)).toEqual({ lastGoodCommit: 'a1b2c3d4' });
  });

  it('saveState escribe JSON que round-trippea', async () => {
    let written = '';
    const fs: ConfigFs = { read: async () => null, write: async (_p, c) => { written = c; } };
    await saveState('/x/.llantas.state.json', { schema: 1, lastGoodCommit: 'abc123' }, fs);
    expect(JSON.parse(written)).toEqual({ schema: 1, lastGoodCommit: 'abc123' });
  });

  it('updateState hace merge y marca el schema', () => {
    expect(updateState({ lastGoodCommit: 'viejo' }, { lastGoodCommit: 'nuevo' })).toEqual({
      schema: 1,
      lastGoodCommit: 'nuevo',
    });
  });
});

describe('buildDetectProbe — le pasa rememberedType al probe (detect.ts se queda puro)', () => {
  const fs: ProbeFs = {
    listEntries: async () => ['package.json', 'vercel.json'],
    readPackageJson: async () => ({ name: 'x', version: '1.0.0' }),
  };

  it('config.type viaja como rememberedType', async () => {
    const probe = await buildDetectProbe('/proj', { type: 'npm' }, fs);
    expect(probe.rememberedType).toBe('npm');
    expect(probe.entries).toEqual(['package.json', 'vercel.json']);
    expect(probe.packageJson).toEqual({ name: 'x', version: '1.0.0' });
  });

  it('sin type en config, rememberedType queda undefined', async () => {
    const probe = await buildDetectProbe('/proj', {}, fs);
    expect(probe.rememberedType).toBeUndefined();
  });
});
