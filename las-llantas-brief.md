# Las Llantas — Brief de Proyecto

**Parte de:** Juegos Imperiales — pipeline de herramientas de Imperio Agéntico
**Rol en el pipeline:** el cierre — El Chasis arma el proyecto al inicio, Las Llantas lo despacha al final
**Capa de IA:** ninguna — 100% determinístico
**Estado:** segunda pasada aplicada — sección 11 separa lo que quedó resuelto de lo que sigue abierto

---

## 1. Problema que resuelve

Hoy cada proyecto tiene su propio ritual para pasar de "ya quedó" a "ya está en vivo": unos van a Vercel, otros al VPS con PM2, otros se publican en npm. Cada uno es una secuencia manual distinta que hay que recordar y ejecutar a mano, y es fácil saltarse un paso — olvidar reiniciar PM2, olvidar subir la versión antes de publicar, dejar un cambio sin commitear.

## 2. Para quién es

- Para publicar cada proyecto de este mismo pipeline, día a día.
- Cualquier persona de Imperio Agéntico con un proyecto en Vercel, VPS+PM2 o npm — sin depender de tokens ni de la topología de servidor de nadie en particular.

## 3. Por qué no es "solo un script con los comandos"

Un script que corre `vercel --prod` o `pm2 restart` no es nada nuevo, y cualquiera lo escribe en un rato. Lo que hace potente a Las Llantas es que cada deploy pasa por tres fases, no una:

1. **Antes** (pre-flight gate) — no toca producción si algo no está en orden.
2. **Durante** — corre la secuencia correcta para el tipo de proyecto detectado.
3. **Después** — verifica de verdad que lo desplegado está sirviendo, no solo que el comando no explotó. Y si la verificación falla, reacciona.

## 4. Alcance

Los 3 tipos de proyecto reales que ya usa el ecosistema — y nada más:

- **Vercel** (ej. El Ancla de Precios, landing de servicios legales)
- **VPS + PM2** (ej. La Guantera y los demás agentes en Hostinger)
- **npm publish** (ej. El Chasis, La Alarma, El Instalador de un Clic)

**Fuera de alcance a propósito:** Docker, Kubernetes, AWS, cualquier otro target. No es falta de ambición — es que intentar cubrirlos rompe la posibilidad de testear todo bien con TDD en un solo sprint.

## 5. Cómo detecta el tipo de proyecto

Por firma de archivos, sin preguntar primero — y en este orden, porque importa:

1. `vercel.json` o carpeta `.vercel/` → **Vercel**
2. `ecosystem.config.js` (o config equivalente de PM2) → **VPS + PM2**
3. Si no calzó en los dos anteriores, y `package.json` tiene `name` + `version` válidos, algún campo `main`/`exports`/`bin`, y NO hay un config de framework de app al lado (`next.config.js`, `vite.config.js`, `nuxt.config.js`, etc.) → **candidato a npm publish**
4. Si nada de lo anterior calza limpio, o calza en más de una categoría → no adivina

El orden importa porque un `package.json` con `name`+`version` es casi universal — hasta un proyecto Next.js desplegado en Vercel lo tiene, sin necesariamente marcarlo como privado. Por eso npm publish es la categoría residual, no la primera que se prueba, y por eso exige además señales positivas de ser una librería.

**Cuando no calza limpio en ninguna categoría, o calza en más de una:** no adivina. Pregunta una sola vez, en lenguaje simple ("no reconozco este proyecto, ¿es Vercel, VPS o npm?"), y guarda la respuesta en un archivo de configuración local (`.llantas.json`, sin datos sensibles, seguro de commitear) para no volver a preguntar la próxima vez.

**Caso especial — npm es el único sin vuelta atrás:** por eso, solo para este tipo, además de la firma de archivo pediría confirmar la identidad del proyecto una vez antes de habilitarlo para publish automático.

**Por qué esto casi no se va a activar en la práctica:** si El Chasis ya deja la firma correcta (o directamente el `.llantas.json`) al scaffoldear un proyecto nuevo, cualquier cosa nacida en este mismo pipeline se detecta limpio desde el día uno. La pregunta de "no reconozco este proyecto" queda casi exclusivamente para alguien de la comunidad instalando Las Llantas sobre un proyecto que ya existía antes.

## 6. El pipeline de 3 fases, por tipo de proyecto

### Vercel
- **Antes:** tests en verde (detecta el comando de test del `package.json`) + `git status` limpio + escaneo de secretos en texto plano sobre el working tree (reusa el escaneo de La Alarma, no el de El Freno de Mano — ver sección 11), mostrando archivo+línea siempre enmascarado, mismo formato ya acordado para El Blindaje
- **Deploy:** `vercel --prod`, usando la sesión de Vercel CLI que la persona ya tiene logueada — Las Llantas nunca gestiona ese login, el token, ni las variables de entorno de build (eso vive en la configuración propia de Vercel)
- **Verificación:** pega a la URL de producción que devuelve Vercel, o al endpoint `/salud` si el proyecto lo expone (misma convención que ya usa La Guantera), y confirma 200 — con un par de reintentos cortos antes de declarar fallo, para no disparar un rollback solo porque el servicio tardó unos segundos en quedar listo
- **Rollback:** si la verificación falla, vuelve al deployment anterior (alias, o el comando de rollback nativo de Vercel si aplica) — casi gratis, porque los deployments previos siguen vivos
- **Si es el primer deploy del proyecto:** no hay "anterior" al cual volver. Si la verificación falla acá, se reporta con claridad en vez de intentar un rollback que no tiene a dónde ir

### VPS + PM2
- **Antes:** mismo bloque de tests + git status + escaneo de secretos, más una prueba trivial de que la conexión SSH ya configurada funciona (sin gestionar la llave, solo confirmar que responde)
- **Deploy:** `git pull` en el servidor → `npm install` → build si aplica → `pm2 restart`. No toca el `.env` del servidor — igual que en Vercel, eso lo gestiona la persona directamente
- **Verificación:** pega al endpoint `/salud` del servicio (convención ya validada con La Guantera: 200 `{"ok":true}`), con un par de reintentos cortos antes de declarar fallo
  - **Si el proyecto no tiene `/salud`:** fallback más débil — confirma que el proceso quedó en estado `online` en PM2 y no está en crash loop. Hay que dejar explícito en el output que esta verificación es más débil que un `/salud` real, no maquillarlo.
- **Cómo sabe cuál es el "anterior":** a diferencia de Vercel, que guarda su propio historial de deployments, un VPS no tiene eso gratis. Las Llantas necesita guardar su propio puntero de "último commit que pasó verificación" en el mismo `.llantas.json`, actualizado solo después de un deploy exitoso — ese puntero es el objetivo real del rollback, no "el commit anterior" a secas
- **Rollback:** si la verificación falla, vuelve al commit marcado como último bueno, reinstala, reinicia PM2, y vuelve a verificar. Deja registrado en el log si el rollback en sí funcionó — no puede fallar en silencio
- **Si es el primer deploy registrado:** todavía no hay puntero de "último bueno". Si la verificación falla acá, se reporta con claridad — no hay a dónde volver

### npm publish
- **Antes:** mismo bloque de tests + git status + escaneo de secretos, pero más estricto que los otros dos — acá no hay vuelta atrás:
  - Confirma que la versión en `package.json` de verdad subió respecto a `npm view <paquete> version`
  - Bloquea si se está a punto de republicar la misma versión por error
- **Deploy:** `npm publish` — con **confirmación explícita de la persona antes de ejecutar**, sin excepción (mismo criterio que ya existe para `git push` / `gh repo create`)
- **Verificación:** corre `npm view <paquete> version` después de publicar (con un reintento corto si el registro tarda en reflejarlo) para confirmar que de verdad quedó publicado
- **Rollback:** no existe. Publicado es publicado. La herramienta puede sugerir `npm deprecate` si la persona se da cuenta después de un error, pero eso es una acción manual, no algo automático. Por eso el pre-flight acá es el más estricto de los tres, no el más relajado.

## 7. No-negociables (heredados del resto de la suite)

- Confirmación explícita antes de cualquier acción irreversible — sobre todo `npm publish`
- Nunca gestiona ni almacena credenciales — lee de lo que la persona ya tiene configurado (Vercel CLI logueada, SSH ya armado, npm login ya hecho). Si algo no está configurado, falla honesto con instrucciones de cómo arreglarlo — no intenta resolverlo por su cuenta
- Escaneo de secretos con `grep -l` / `grep -q` (nunca `grep -n`), igual que el resto de la suite
- Cero llamadas a modelos o APIs de IA — 100% determinístico, cero API key que configurar

## 8. Experiencia para alguien que lo ve por primera vez

- Instalación vía npm, mismo patrón que El Chasis / La Alarma
- Primer uso: muestra en lenguaje simple qué detectó y qué va a hacer, ANTES de tocar nada, y pide confirmación
- Errores traducidos a lenguaje simple, nunca jerga cruda de sistema (no "ECONNREFUSED" pelado — "no pude conectarme a tu servidor, revisá que el SSH esté configurado")
- Modo `--dry-run`: muestra qué haría sin ejecutar nada — para que alguien nuevo pueda confiar antes de correrlo de verdad, y también sirve para debugging

## 9. Testing (TDD, Vitest — igual que el resto del pipeline)

- Todo lo que toca sistemas reales (Vercel CLI, SSH, registro de npm) se mockea en los tests unitarios — nunca un deploy real en cada corrida de tests
- Demo/integración: un proyecto ficticio de prueba por cada uno de los 3 tipos, sin tocar producción real
- Casos de fallo a cubrir explícitamente: falla el pre-flight (tests rotos, secretos encontrados), falla el deploy en sí, falla la verificación post-deploy después de agotar los reintentos (y se dispara el rollback), el caso "no reconozco este proyecto" (y que la respuesta quede recordada en la corrida siguiente), y el caso "es el primer deploy y no hay puntero de rollback todavía"

## 10. Qué NO es esta herramienta

- No es gestor de secretos → eso es La Llave de Encendido, más adelante
- No es auditor de dependencias vulnerables → eso es El Filtro
- No cubre Docker/K8s/AWS ni otros targets
- No tiene ni necesita capa de IA
- No gestiona variables de entorno de build — vive en la configuración propia de cada plataforma
- No maneja staging y producción como entornos separados en v1 — un solo entorno de destino por proyecto

## 11. Supuestos y riesgos a confirmar juntos antes de pasar a plan mode

**Resuelto en esta pasada** (queda la decisión tomada en el brief; avisen si la ven distinta):

- La heurística de npm publish quedó como cascada de prioridad (sección 5): Vercel y VPS+PM2 se prueban primero por firma de archivo específica; npm es la categoría residual y exige señales positivas de librería (`main`/`exports`/`bin`, sin config de framework de app al lado)
- El rollback de VPS+PM2 no puede ser "el commit anterior" a secas — no hay forma de saberlo solo con git en un VPS. Las Llantas guarda su propio puntero de "último commit que pasó verificación" en `.llantas.json`
- Tanto Vercel como VPS+PM2 tienen un caso de "primer deploy" donde no existe todavía un objetivo de rollback — ahí se reporta el fallo con claridad en vez de intentar volver a un lado que no existe
- Las verificaciones post-deploy (los 3 tipos) reintentan un par de veces con espera corta antes de declarar fallo, para no disparar rollbacks por una demora normal de arranque
- **El escaneo de secretos se reusa de La Alarma, no de El Freno de Mano** — La Alarma es un auditor batch de sistemas completos (mismo tipo de operación que necesita el pre-flight de Las Llantas); El Freno de Mano es un hook en vivo dentro de una sesión de Claude Code, una arquitectura distinta que no encaja en una revisión previa a un deploy. Queda para el momento de construirlo confirmar si la lógica de La Alarma ya está expuesta como módulo importable o si hay que extraerla primero — eso es detalle de implementación, no bloquea el brief

**Siguen abiertos:**

1. **¿Corre local o en CI?** Se asume que corre en la máquina/sesión de cada quien (igual que El Freno de Mano, El Chasis, etc.), no en un pipeline de CI — esto simplifica mucho el diseño porque no hay que resolver secretos de CI. Si en algún momento la idea es que corra en CI, el diseño cambia bastante.
2. **No todos los VPS+PM2 van a tener `/salud`:** el fallback (estado PM2 sin crash loop) es más débil. Vale la pena decidir si eso es aceptable o si conviene exigir el endpoint como requisito para ese proyecto.
3. **Nombre del paquete y comando:** se propone `las-llantas` como paquete npm y `llantas` como comando corto, siguiendo la convención de El Chasis / La Alarma.
4. **Gancho de diseño para El Volante:** cuando exista, va a querer ajustar qué tan estricto es el pre-flight gate según el modo (Eco/Confort/Sport). Para no tener que reescribir Las Llantas después, propongo que las reglas del gate vivan desde el día uno en un objeto de configuración interno, no en condicionales sueltos por el código — sin construir la integración ahora, solo dejando la puerta abierta.

## 12. Definición de "listo para publicar"

- Tests en verde con Vitest (unitarios + demo de integración mockeada)
- Demo end-to-end mostrando los 3 tipos de proyecto, sin tocar producción real
- Auditoría de git limpia: sin secretos, sin rutas locales, sin `dist/` ni `settings.json` con datos reales
- README claro con instalación y los 3 flujos documentados con ejemplos — es la pieza clave para que alguien nuevo lo entienda sin tener que preguntar
- Publicado en npm, con el post de Logro siguiendo el formato de 5 partes (sistema, problema, stack, antes/después con números, capturas/video opcional)
