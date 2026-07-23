import { describe, it, expect } from 'vitest';
import {
  scanFiles,
  scanWorkingTree,
  type ScanFsDeps,
} from '../src/preflight/secret-scan.js';
import { SYNTHETIC_TOKEN, SYNTHETIC_SECRETS } from './support/synthetic-secrets.js';

describe('scanFiles — escaneo de secretos sobre contenidos ya leídos (puro)', () => {
  it('encuentra un secreto y reporta archivo + línea (1-indexed)', () => {
    const content = `linea limpia\nGITHUB_TOKEN=${SYNTHETIC_TOKEN}\notra linea`;
    const findings = scanFiles([{ path: '.env', content }]);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: '.env', line: 2, rule: 'github-pat' });
    expect(findings[0].description).toBeTruthy();
  });

  it('nunca incluye el valor crudo del secreto en el hallazgo', () => {
    const content = `KEY=${SYNTHETIC_TOKEN}`;
    const findings = scanFiles([{ path: 'config.js', content }]);

    expect(JSON.stringify(findings)).not.toContain(SYNTHETIC_TOKEN);
  });

  it('archivo limpio → sin hallazgos', () => {
    const findings = scanFiles([{ path: 'app.js', content: 'const x = 1;\nconsole.log(x);' }]);
    expect(findings).toEqual([]);
  });

  it('reporta un hallazgo por cada ubicación, en varios archivos y líneas', () => {
    const a = `nada\nAKIA=${SYNTHETIC_SECRETS['aws-access-key']}`;
    const b = `sk=${SYNTHETIC_SECRETS['stripe-key']}\nnada`;
    const findings = scanFiles([
      { path: 'a.env', content: a },
      { path: 'b.env', content: b },
    ]);

    expect(findings).toEqual([
      expect.objectContaining({ file: 'a.env', line: 2, rule: 'aws-access-key' }),
      expect.objectContaining({ file: 'b.env', line: 1, rule: 'stripe-key' }),
    ]);
  });

  it('una línea con dos formas de secreto → un hallazgo por regla', () => {
    const content = `X=${SYNTHETIC_SECRETS['github-pat']} Y=${SYNTHETIC_SECRETS['aws-access-key']}`;
    const rules = scanFiles([{ path: 'mix.env', content }]).map((f) => f.rule);

    expect(rules).toContain('github-pat');
    expect(rules).toContain('aws-access-key');
  });
});

describe('scanWorkingTree — envoltorio de I/O con deps inyectables', () => {
  it('lee lo que lista listFiles y agrega los hallazgos con su ruta', async () => {
    const deps: ScanFsDeps = {
      listFiles: async () => ['config.env', 'clean.txt'],
      readFile: async (_cwd, rel) =>
        rel === 'config.env' ? `KEY=${SYNTHETIC_TOKEN}` : 'nada que ver',
    };

    const findings = await scanWorkingTree('/fake/project', deps);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'config.env', line: 1, rule: 'github-pat' });
  });

  it('working tree limpio → sin hallazgos', async () => {
    const deps: ScanFsDeps = {
      listFiles: async () => ['a.js', 'b.js'],
      readFile: async () => 'código totalmente limpio',
    };

    expect(await scanWorkingTree('/fake', deps)).toEqual([]);
  });
});
