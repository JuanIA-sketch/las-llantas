import { describe, it, expect } from 'vitest';
import { detectType, type DetectProbe } from '../src/core/detect.js';

/** Probe base: nada presente, sin package.json. Cada test agrega lo que necesita. */
function probe(overrides: Partial<DetectProbe> = {}): DetectProbe {
  return { entries: [], packageJson: null, ...overrides };
}

describe('detectType — cascada de detección (§5)', () => {
  it('vercel.json presente → vercel', () => {
    const r = detectType(probe({ entries: ['package.json', 'vercel.json'] }));
    expect(r).toEqual({ kind: 'vercel' });
  });

  it('carpeta .vercel/ presente → vercel', () => {
    const r = detectType(probe({ entries: ['.vercel', 'package.json'] }));
    expect(r).toEqual({ kind: 'vercel' });
  });

  it('ecosystem.config.js presente → pm2', () => {
    const r = detectType(probe({ entries: ['ecosystem.config.js', 'package.json'] }));
    expect(r).toEqual({ kind: 'pm2' });
  });

  it('package.json con name+version+main y sin config de framework → npm', () => {
    const r = detectType(
      probe({
        entries: ['package.json'],
        packageJson: { name: 'mi-lib', version: '1.2.3', main: 'index.js' },
      }),
    );
    expect(r).toEqual({ kind: 'npm' });
  });

  it('bin cuenta como señal de librería (sin main/exports) → npm', () => {
    const r = detectType(
      probe({
        entries: ['package.json'],
        packageJson: { name: 'mi-cli', version: '0.1.0', bin: { 'mi-cli': 'bin/cli.js' } },
      }),
    );
    expect(r).toEqual({ kind: 'npm' });
  });

  it('librería válida pero con next.config.js al lado → no es npm (needs-confirmation unknown)', () => {
    const r = detectType(
      probe({
        entries: ['package.json', 'next.config.js'],
        packageJson: { name: 'app', version: '1.0.0', main: 'index.js' },
      }),
    );
    expect(r).toEqual({ kind: 'needs-confirmation', reason: 'unknown' });
  });

  it('package.json con name+version pero sin main/exports/bin → no es npm (needs-confirmation unknown)', () => {
    const r = detectType(
      probe({
        entries: ['package.json'],
        packageJson: { name: 'algo', version: '1.0.0' },
      }),
    );
    expect(r).toEqual({ kind: 'needs-confirmation', reason: 'unknown' });
  });

  it('vercel.json y ecosystem.config.js a la vez → needs-confirmation ambiguous', () => {
    const r = detectType(
      probe({ entries: ['vercel.json', 'ecosystem.config.js', 'package.json'] }),
    );
    expect(r).toEqual({ kind: 'needs-confirmation', reason: 'ambiguous' });
  });

  it('carpeta sin firmas reconocibles → needs-confirmation unknown', () => {
    const r = detectType(probe({ entries: ['README.md', 'index.html'] }));
    expect(r).toEqual({ kind: 'needs-confirmation', reason: 'unknown' });
  });

  it('rememberedType overridea la cascada (aunque la firma diga otra cosa)', () => {
    const r = detectType(
      probe({ entries: ['ecosystem.config.js', 'package.json'], rememberedType: 'vercel' }),
    );
    expect(r).toEqual({ kind: 'vercel' });
  });
});
