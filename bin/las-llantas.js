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

// Node avisa (DEP0190) que pasar args con shell:true no los escapa. En Las Llantas
// eso ya está cerrado: exec.ts valida cada argumento con isShellSafeArg (rechaza
// espacios y metacaracteres de shell) antes de pasarlo. Silenciamos SOLO ese warning
// para no ensuciar el output; cualquier otro warning de Node se sigue mostrando.
const emitOriginal = process.emit;
process.emit = function (name, data, ...rest) {
  if (name === 'warning' && data && data.name === 'DeprecationWarning' && data.code === 'DEP0190') {
    return false;
  }
  return emitOriginal.call(this, name, data, ...rest);
};

const { main } = await import('../dist/cli.js');
const code = await main(process.argv.slice(2), process.cwd());
process.exit(code);
