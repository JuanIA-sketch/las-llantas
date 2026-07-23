#!/usr/bin/env node
// Entrada de Las Llantas. Requiere `npm run build` (o el prepare de npm install),
// que compila src/ a dist/. Guard de versión antes de importar nada del build.

const [mayor] = process.versions.node.split('.').map(Number);
if (mayor < 20) {
  console.error(
    `Las Llantas necesita Node 20 o más nuevo (tenés la ${process.versions.node}).\n` +
      'Actualizá en https://nodejs.org y volvé a correrlo.'
  );
  process.exit(1);
}

const { main } = await import('../dist/cli.js');
const code = await main(process.argv.slice(2), process.cwd());
process.exit(code);
