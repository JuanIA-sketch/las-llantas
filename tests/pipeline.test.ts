import { describe, it, expect } from 'vitest';
import { runDeploy, type PipelineDeps } from '../src/core/pipeline.js';
import type { Deployer } from '../src/core/types.js';
import type { GateResult } from '../src/core/gate.js';

const passingGate: GateResult = { passed: true, results: [] };
const failingGate: GateResult = {
  passed: false,
  results: [{ id: 'tests', ok: false, blocking: true, detail: '2 en rojo' }],
};

/** Deployer falso con contadores de llamadas y resultados configurables. */
function makeDeployer(over: Partial<Record<'deploy' | 'verify' | 'rollback', unknown>> = {}) {
  const calls = { deploy: 0, verify: 0, rollback: 0 };
  const deployer: Deployer = {
    deploy: async () => { calls.deploy++; return (over.deploy as any) ?? { ok: true, url: 'https://x.app' }; },
    verify: async () => { calls.verify++; return (over.verify as any) ?? { ok: true, status: 200 }; },
    rollback: async () => { calls.rollback++; return (over.rollback as any) ?? { attempted: true, ok: true }; },
  };
  return { deployer, calls };
}

function makeDeps(over: Partial<PipelineDeps> = {}): { deps: PipelineDeps; log: string[]; flags: any } {
  const log: string[] = [];
  const flags = { confirm: 0, onVerified: 0, gate: 0 };
  const deps: PipelineDeps = {
    runGate: async () => { flags.gate++; return passingGate; },
    deployer: makeDeployer().deployer,
    needsConfirmation: false,
    confirm: async () => { flags.confirm++; return true; },
    dryRun: false,
    onVerified: async () => { flags.onVerified++; },
    log: (m) => log.push(m),
    planText: 'PLAN: vercel --prod → verificar 200',
    ...over,
  };
  return { deps, log, flags };
}

describe('runDeploy — orquestador de las 3 fases (§6, §8, §9)', () => {
  it('dry-run: corre el gate (solo-lectura) y muestra el plan, sin ejecutar deploy/verify/rollback', async () => {
    const { deployer, calls } = makeDeployer();
    const { deps, log, flags } = makeDeps({ deployer, dryRun: true });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: true, stage: 'plan' });
    expect(flags.gate).toBe(1);   // el gate SÍ corre: no toca producción
    expect(calls.deploy).toBe(0); // pero no despliega
    expect(log.join('\n')).toContain('PLAN: vercel --prod');
  });

  it('dry-run con gate que falla → lo muestra, no ejecuta deploy [§8]', async () => {
    const { deployer, calls } = makeDeployer();
    const { deps, log, flags } = makeDeps({ deployer, dryRun: true, runGate: async () => failingGate });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: false, stage: 'plan' });
    expect(r.gate).toBe(failingGate);   // el veredicto del gate viaja en el resultado
    expect(calls.deploy).toBe(0);       // no se ejecutó deploy
    expect(flags.onVerified).toBe(0);
    expect(log.join('\n')).toMatch(/BLOQUEAR/i);
  });

  it('gate bloquea → no despliega, termina en stage gate [§9]', async () => {
    const { deployer, calls } = makeDeployer();
    const { deps } = makeDeps({ deployer, runGate: async () => failingGate });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: false, stage: 'gate' });
    expect(r.gate).toBe(failingGate);
    expect(calls.deploy).toBe(0);
  });

  it('necesita confirmación y el usuario dice que no → cancela sin desplegar', async () => {
    const { deployer, calls } = makeDeployer();
    const { deps } = makeDeps({ deployer, needsConfirmation: true, confirm: async () => false });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: false, stage: 'confirm' });
    expect(calls.deploy).toBe(0);
  });

  it('no necesita confirmación → nunca llama a confirm', async () => {
    const { deps, flags } = makeDeps({ needsConfirmation: false });
    await runDeploy(deps);
    expect(flags.confirm).toBe(0);
  });

  it('happy path: gate ok + deploy ok + verify ok → persiste (onVerified) y termina en done', async () => {
    const { deps, flags } = makeDeps();
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: true, stage: 'done' });
    expect(flags.onVerified).toBe(1);
  });

  it('verify DÉBIL (weak) aunque sea ok → advertencia PROMINENTE y NO persiste (no avanza el puntero de rollback)', async () => {
    const { deployer } = makeDeployer({ verify: { ok: true, weak: true, detail: 'solo proceso online' } });
    const { deps, log, flags } = makeDeps({ deployer });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: true, stage: 'done' });
    expect(flags.onVerified).toBe(0); // verificación débil NO persiste
    expect(log.join('\n')).toMatch(/VERIFICACIÓN DÉBIL/);
    expect(log.join('\n')).toMatch(/rollback NO avanzó/i);
  });

  it('deploy falla → no verifica ni persiste, termina en stage deploy [§9]', async () => {
    const { deployer, calls } = makeDeployer({ deploy: { ok: false, detail: 'vercel falló' } });
    const { deps, flags } = makeDeps({ deployer });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: false, stage: 'deploy' });
    expect(calls.verify).toBe(0);
    expect(flags.onVerified).toBe(0);
  });

  it('verify falla → dispara rollback y NO persiste; el resultado del rollback queda registrado [§9]', async () => {
    const { deployer, calls } = makeDeployer({
      verify: { ok: false, status: 503 },
      rollback: { attempted: true, ok: true },
    });
    const { deps, flags } = makeDeps({ deployer });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: false, stage: 'rollback' });
    expect(calls.rollback).toBe(1);
    expect(flags.onVerified).toBe(0);
    expect(r.rollback).toEqual({ attempted: true, ok: true });
  });

  it('verify falla en primer deploy (rollback sin destino) → se reporta claro, sin persistir [§9]', async () => {
    const { deployer } = makeDeployer({
      verify: { ok: false, status: 503 },
      rollback: { attempted: false, ok: false, detail: 'primer deploy: no hay a dónde volver' },
    });
    const { deps, flags } = makeDeps({ deployer });
    const r = await runDeploy(deps);

    expect(r).toMatchObject({ ok: false, stage: 'rollback' });
    expect(r.rollback).toMatchObject({ attempted: false });
    expect(flags.onVerified).toBe(0);
  });
});
