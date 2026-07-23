/**
 * Traducción de errores crudos de sistema a lenguaje simple (§8): nunca mostrar
 * "ECONNREFUSED" pelado, sino "no pude conectarme…". Si el mensaje ya es legible
 * (uno que armamos nosotros), se devuelve tal cual.
 */

function codeOf(err: unknown): string {
  const e = err as { code?: unknown; syscall?: unknown };
  const code = typeof e?.code === 'string' ? e.code : '';
  const syscall = typeof e?.syscall === 'string' ? e.syscall : '';
  return `${code} ${syscall}`;
}

export function friendlyError(err: unknown): string {
  const raw = codeOf(err);

  if (/ECONNREFUSED/.test(raw)) {
    return 'No pude conectarme al servicio. Revisá que esté arriba (y, si es un VPS, que el SSH esté configurado).';
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(raw)) {
    return 'No pude encontrar la dirección del host. Revisá el nombre del servidor o tu conexión.';
  }
  if (/ETIMEDOUT/.test(raw)) {
    return 'La conexión tardó demasiado y expiró. Revisá que el servicio esté respondiendo.';
  }
  if (/ENOENT/.test(raw) && /spawn/.test(raw)) {
    const cmd = raw.match(/spawn\s+(\S+)/)?.[1];
    return `No encontré el comando${cmd ? ` "${cmd}"` : ''}. Revisá que esté instalado y en el PATH.`;
  }

  if (err instanceof Error) return err.message;
  return String(err);
}
