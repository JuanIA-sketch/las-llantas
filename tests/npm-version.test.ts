import { describe, it, expect } from 'vitest';
import {
  compareSemver,
  checkVersionBumped,
  checkVersionNotDuplicate,
  type RegistryLookup,
} from '../src/preflight/npm-version.js';

const published = (version: string): RegistryLookup => async () => ({ published: true, version });
const unpublished: RegistryLookup = async () => ({ published: false, version: '' });

describe('compareSemver', () => {
  it('compara release numéricamente (no lexicalmente)', () => {
    expect(compareSemver('1.2.3', '1.2.2')).toBe(1);
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
    expect(compareSemver('1.2.3', '1.3.0')).toBe(-1);
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1); // 10 > 9, no "1" < "9"
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('una versión con prerelease es menor que la misma sin prerelease', () => {
    expect(compareSemver('1.2.3', '1.2.3-beta')).toBe(1);
    expect(compareSemver('1.2.3-beta', '1.2.3')).toBe(-1);
    expect(compareSemver('1.2.3-beta', '1.2.3-alpha')).toBe(1);
  });
});

describe('checkVersionBumped (regla de gate npm)', () => {
  it('local mayor que la publicada → ok', async () => {
    expect((await checkVersionBumped('1.2.3', published('1.2.2'))).ok).toBe(true);
  });

  it('local igual a la publicada → not ok (no subió la versión)', async () => {
    const r = await checkVersionBumped('1.2.3', published('1.2.3'));
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it('local menor (downgrade) → not ok', async () => {
    expect((await checkVersionBumped('1.2.2', published('1.2.3'))).ok).toBe(false);
  });

  it('paquete no publicado todavía → ok (primer publish, cualquier versión válida es un bump)', async () => {
    expect((await checkVersionBumped('0.1.0', unpublished)).ok).toBe(true);
  });
});

describe('checkVersionNotDuplicate (regla de gate npm)', () => {
  it('misma versión que la publicada → not ok (republicaría la misma)', async () => {
    const r = await checkVersionNotDuplicate('1.2.3', published('1.2.3'));
    expect(r.ok).toBe(false);
    expect(r.detail).toBeTruthy();
  });

  it('versión distinta → ok', async () => {
    expect((await checkVersionNotDuplicate('1.2.4', published('1.2.3'))).ok).toBe(true);
  });

  it('paquete no publicado → ok (no hay nada que duplicar)', async () => {
    expect((await checkVersionNotDuplicate('1.0.0', unpublished)).ok).toBe(true);
  });
});
