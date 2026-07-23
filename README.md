# Las Llantas 🛞

El **cierre** del pipeline de Juegos Imperiales: despacha cada proyecto a producción con un solo comando. El Chasis arma el proyecto al inicio; Las Llantas lo pone en vivo al final.

No es "un script con `vercel --prod`". Cada deploy pasa por **tres fases**, no una:

1. **Antes** (pre-flight gate) — no toca producción si algo no está en orden.
2. **Durante** — corre la secuencia correcta para el tipo de proyecto detectado.
3. **Después** — verifica de verdad que lo desplegado está sirviendo, y si falla, **reacciona** (rollback).

100% determinístico: **cero IA, cero API keys que configurar**.

## Qué despliega

Los 3 targets reales del ecosistema — y nada más (Docker/K8s/AWS quedan fuera a propósito):

| Tipo | Cómo lo detecta | Deploy | Verificación | Rollback |
|---|---|---|---|---|
| **Vercel** | `vercel.json` o `.vercel/` | `vercel --prod` | 200 en la URL de producción (con reintentos) | vuelve al deployment anterior |
| **VPS + PM2** | `ecosystem.config.js` | `git pull` → `npm install` → build? → `pm2 restart` | `/salud` (200) o, si no lo expone, estado PM2 online (verificación más débil, avisada) | vuelve al último commit bueno + re-verifica |
| **npm** | `package.json` de librería (`main`/`exports`/`bin`, sin config de framework) | `npm publish` | `npm view` confirma la versión | **no existe** — sugiere `npm deprecate` |

## Requisitos

- **Node ≥ 20**
- Las Llantas **nunca gestiona credenciales**. Lee de lo que ya tenés configurado:
  - **Vercel:** la CLI de Vercel logueada (`vercel login`).
  - **VPS + PM2:** acceso SSH por llave ya configurado al server del `ecosystem.config.js`.
  - **npm:** `npm login` ya hecho. Si tu cuenta exige confirmación interactiva en cada publish, ese prompt te llega en el momento (ver [npm publish](#npm-publish)).
- Si algo no está configurado, falla honesto con instrucciones — no intenta resolverlo por su cuenta.

## Instalación

```bash
npm install -g las-llantas
```

## Uso

```bash
# Detecta el tipo, muestra qué va a hacer, y despliega:
llantas

# Muestra qué haría (corre el pre-flight real) SIN desplegar nada:
llantas --dry-run
```

`llantas` detecta el tipo de proyecto por sus archivos y corre el flujo que corresponde. La primera vez muestra en lenguaje simple qué detectó y qué va a hacer.

### Vercel

```bash
$ llantas
📋 Voy a hacer esto (Vercel):
   1. Pre-flight: tests en verde + git limpio + escaneo de secretos
   2. Deploy: vercel --prod (con tu sesión de Vercel ya logueada)
   3. Verificar 200 en la URL de producción (con reintentos cortos)
   4. Si la verificación falla: rollback al deployment anterior
```

La **primera** vez pide confirmación. Después, un deploy de rutina corre de una sola pasada. Si la verificación post-deploy falla, vuelve al deployment anterior automáticamente.

### VPS + PM2

Lee el target SSH, el directorio, el proceso y la rama del `ecosystem.config.js` (bloque `deploy`). Guarda su propio puntero de "último commit que pasó verificación" en `.llantas.json`; ese es el objetivo del rollback (un VPS no tiene historial de deployments como Vercel).

**En el primer deploy te pregunta si tu servicio expone un endpoint de salud y en qué URL**, y lo guarda en `.llantas.json` (`healthUrl`). Si lo configurás, verifica ahí (200) tras cada deploy — verificación **fuerte**: caza un servicio que arrancó pero responde 500.

La verificación corre con **`curl` DENTRO del server, por SSH** (no un fetch desde tu máquina). Por eso el `healthUrl` puede ser **loopback** (`http://127.0.0.1:3999/salud`) apuntando al servicio real, sin necesidad de exponer el puerto públicamente. Requiere `curl` instalado en el server (lo está en casi cualquier Linux).

Si lo saltás, cae al **fallback débil**: solo confirma que el proceso quedó `online` en PM2. **Ojo:** ese fallback nunca hace HTTP, así que **no distingue "vivo" de "vivo pero roto"** — un deploy que sirve 500 lo daría por bueno. Por eso, cuando la verificación es débil:

- Las Llantas lo **grita** con una advertencia imposible de perder (no una nota al pie), y
- **NO avanza `lastGoodCommit`** — el puntero de rollback solo se mueve con una verificación **fuerte**. Así la seguridad del rollback es estructural: si nunca configurás `healthUrl`, el puntero simplemente nunca avanza (nunca apunta a un commit que no se confirmó de verdad), en vez de dar un falso positivo.

### npm publish

El pre-flight más estricto, porque **publicar no tiene vuelta atrás**:

- Confirma que la versión de `package.json` de verdad **subió** respecto a `npm view`.
- **Bloquea** si estás por republicar la misma versión.
- La **primera** vez confirma la identidad del paquete (una sola pregunta, se recuerda).
- **Siempre** pide confirmación explícita antes de `npm publish` — pregunta separada de la anterior.

#### Cuentas con confirmación interactiva en cada publish

Algunas cuentas de npm exigen, por seguridad, una **confirmación interactiva por navegador (u OTP) en CADA `npm publish`** — no solo en el `npm login`. Las Llantas corre `npm publish` **heredando el stdio real de tu terminal** (stdin/stdout/stderr conectados, no capturados en un pipe). Por eso, si tu cuenta tiene esa protección activada:

- El prompt de npm **te aparece en la terminal en el momento** y lo respondés ahí, igual que la confirmación propia de Las Llantas.
- **Esto es esperado, no es un error.** Si publicar "se cuelga" esperando, es npm pidiéndote esa confirmación — respondela y el flujo sigue.

> Detalle técnico: si `npm publish` se ejecutara con la salida capturada en un pipe (como el resto de los comandos), ese prompt no le llegaría a nadie y el publish fallaría de forma genérica o quedaría colgado. Por eso este comando —y solo este— hereda el stdio real. La verificación posterior se hace aparte con `npm view`.

## Estado en disco: dos archivos por ciclo de vida

Las Llantas separa lo que se fija una vez de lo que cambia en cada deploy:

**`.llantas.json`** — **seguro de commitear** (sin llaves ni passwords). Valores que se fijan una vez y no cambian deploy a deploy:

```jsonc
{
  "type": "vercel | pm2 | npm",   // tipo recordado (detección o confirmación)
  "vercelDeployedOnce": true,      // vercel: ya hubo un deploy exitoso (flag set-once)
  "npmIdentityConfirmed": true,    // npm: identidad confirmada una vez
  "healthUrl": "https://..."       // pm2 (opcional): endpoint /salud
}
```

**`.llantas.state.json`** — **gitignorealo** (agregalo a tu `.gitignore`). Estado **mutable** que cambia en cada deploy:

```jsonc
{ "lastGoodCommit": "<sha>" }      // pm2: objetivo del rollback, se actualiza en cada deploy verificado
```

> Por qué separados: `lastGoodCommit` cambia en cada deploy de PM2. Si viviera en el archivo commiteado, cada deploy dejaría el working tree sucio y el `git-clean` del siguiente deploy fallaría. Si el estado no está gitignoreado, Las Llantas te avisa para que lo agregues.

Si El Chasis ya deja `.llantas.json` (o la firma correcta) al scaffoldear, Las Llantas detecta todo desde el día uno. Cuando un proyecto no calza limpio en ningún tipo, pregunta **una sola vez** ("no reconozco este proyecto, ¿es Vercel, VPS o npm?") y recuerda la respuesta.

## No-negociables

- **Confirmación explícita** antes de cualquier acción irreversible — sobre todo `npm publish`.
- **Nunca** gestiona ni almacena credenciales.
- Escaneo de secretos sobre el working tree antes de desplegar (reusa el detector de **La Alarma**); nunca imprime el valor de un secreto, solo su ubicación.
- Barreras contra inyección de comandos: los argumentos de los comandos locales se validan como tokens simples, y los valores que se interpolan en comandos remotos por SSH se validan/escapan (POSIX).
- **Cero** llamadas a modelos o APIs de IA.

## Qué NO es

- No es gestor de secretos (eso es La Llave de Encendido).
- No es auditor de dependencias (eso es El Filtro).
- No cubre Docker/K8s/AWS ni otros targets.
- No gestiona variables de entorno de build — viven en la config de cada plataforma.
- No maneja staging y producción como entornos separados: un solo destino por proyecto.

## Limitación conocida

`ecosystem.config.js` se carga con `import()`. Un proyecto ESM (`"type": "module"` en su `package.json`) con un `ecosystem.config.js` escrito en CommonJS (`module.exports`) fallaría al cargar — en ese caso, renombralo a **`ecosystem.config.cjs`** (ya soportado).

## Desarrollo

```bash
npm install
npm test        # Vitest: unitarios + integración mockeada (sin tocar producción real)
npm run build   # compila src/ a dist/
```

Todo lo que toca sistemas reales (Vercel CLI, SSH, registro de npm, HTTP) se inyecta y se mockea en los tests — nunca un deploy real por corrida.

## Licencia

[MIT](LICENSE)
