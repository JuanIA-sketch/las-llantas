# Las Llantas

El cierre del pipeline de Juegos Imperiales: despacha proyectos a producción (Vercel, VPS+PM2, npm) en 3 fases — pre-flight gate → deploy → verificación con reintentos y rollback. 100% determinístico, sin capa de IA.

Contexto completo del diseño en `las-llantas-brief.md` — leerlo antes de tocar código.

## Estado actual
- **Los 3 deployers implementados y cableados al cli, punta a punta.** 132 tests en verde (Vitest), `tsc` limpio.
- Vercel y npm se prueban por firma de archivo; npm es la categoría residual (exige señales de librería).
- Falta solo lo cosmético de la §12 del brief: `git init` + auditoría con La Alarma, y el post de Logro.

## Cómo correr
```bash
npm install
npm test        # unitarios + integración mockeada
npm run build   # tsc → dist/
node bin/las-llantas.js --dry-run   # el binario real
```

## Arquitectura (misma DI que La Alarma)
- **`src/cli.ts`** — `runCli(argv, deps)` con TODO el I/O inyectado (fs, exec, ssh, http, prompt); testeable de punta a punta con fakes. `main()` arma las deps reales; guard de entry-point. Un `run<Tipo>Flow` por tipo.
- **`src/core/pipeline.ts`** — `runDeploy(deps)`: orquesta gate → mostrar plan → [confirmar] → deploy → verify → rollback. Genérico sobre la interfaz `Deployer`. `--dry-run` corre el gate (solo-lectura) y NO ejecuta deploy/verify/rollback. `onVerified` (persistir éxito) solo tras verify OK.
- **`src/core/gate.ts`** — `GATE_PROFILES` (objeto de config por tipo, gancho para El Volante) + `runGate`. **Las 12 reglas de los 3 perfiles son `blocking: true`** (test de regresión lo fija; `blocking:false` se reserva para cuando El Volante exista).
- **`src/core/detect.ts`** — cascada de detección PURA (§5). El `rememberedType` de `.llantas.json` entra por el probe (lo arma `config.ts`); detect nunca lee disco.
- **`src/deployers/{vercel,pm2,npm}.ts`** — cada uno implementa `Deployer { deploy, verify, rollback }` con sus runners inyectados.
- **`src/preflight/`** — runners del gate: `run-tests`, `git-status`, `secret-scan` (reusa `detectSecrets` vendorizado de La Alarma), `npm-version`.
- **`src/runners/`** — BORDES de I/O (exec, ssh, http, fs): sin test unitario, cubiertos por la integración del cli.

## Decisiones resueltas (no re-litigar)
- Escaneo de secretos = `detectSecrets` de La Alarma (`src/core/secret-patterns.ts`, vendorizado de la-alarma@0.1.1) sobre el working tree — NO gitleaks, sin dependencia nueva.
- VPS sin `/salud`: se acepta el fallback débil (estado PM2 online), marcado explícito en el output.
- `.llantas.json` es seguro de commitear (sin secretos). El target SSH sale del `ecosystem.config.js`, no se guarda ahí.
- Rollback PM2 vuelve a la RAMA (`git checkout <branch> && git reset --hard <commit>`), no a un SHA suelto (evita detached HEAD que rompería el próximo `git pull --ff-only`).
- npm: identidad (una vez) y publish (always-confirm) son DOS confirmaciones separadas.

## Convenciones del stack (heredadas de Charly)
- TDD rojo→verde con Vitest. No se escribe implementación antes del test que falla.
- `git push` / `gh repo create` / `npm publish` requieren confirmación explícita, nunca automáticos.
- Al buscar credenciales: `grep -l`/`grep -q`, nunca `grep -n`. Los `Finding` nunca llevan el valor del secreto.
- Barreras anti-inyección: args de exec local validados como tokens simples (`isShellSafeArg`); valores en comandos remotos SSH validados/escapados (POSIX).
- Solo fixtures sintéticos en `tests/support/` — cero secretos reales.

## Comando de recuperación
"Lee CLAUDE.md y las-llantas-brief.md. Corré `npm test` para ver el estado. Los 3 deployers están listos; lo que falta es la auditoría de git y el post de Logro (§12 del brief)."
