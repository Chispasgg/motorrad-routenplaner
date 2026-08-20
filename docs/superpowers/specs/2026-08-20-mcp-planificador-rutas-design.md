# Servidor MCP para planificar rutas

**Fecha:** 2026-08-20
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Permitir que un agente planifique rutas de moto sin abrir la web: interpretar una
petición en lenguaje natural («de Bilbao a Jaca, curvas, evitando obras»), calcular la
ruta con el backend existente y devolver tanto un resumen legible como un enlace que
abra esa misma ruta en el mapa.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Propósito | Planificar y además abrir en la web |
| Transporte | MCP HTTP en la LAN, patrón de Obscura |
| Paso de la ruta a la web | Enlace autocontenido, todo en la URL |
| Ubicación | Workspace `mcp/` del monorepo |
| Acceso a la lógica | Capa delgada sobre `/api/*` del backend |
| Herramientas en v1 | Dos: `plan_route` y `geocode_place` |
| Ejecutable Windows | Sin cambios; el MCP no se empaqueta en la EXE |

## Arquitectura

```
Agente (Claude Code, Claude Desktop, otro)
   │  MCP HTTP (JSON-RPC)  →  192.168.65.9:9641/mcp
   ▼
Contenedor mcp  (workspace mcp/)
   │  HTTP interno  →  motorrad-routenplaner-backend:8080/api/*
   ▼
Backend Fastify  →  BRouter local, Overpass, Nominatim, Open-Meteo
```

El servidor MCP no contiene lógica de routing. Traduce argumentos, llama al backend, da
forma al resultado para un agente y construye el enlace público. No guarda estado entre
llamadas.

## Herramientas

### `plan_route`

Calcula una ruta y devuelve resumen más enlace a la web.

Entrada:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `points` | array de string | sí | Nombre de lugar o `"lng,lat"`. Entre 2 y 10 elementos |
| `profile` | enum | no | `fast`, `curvy`, `autobahn`. Por defecto `curvy` |
| `profiles` | array de enum | no | Uno por tramo; tiene prioridad sobre `profile` |
| `round_trip` | boolean | no | Añade el regreso al punto inicial |
| `avoid_roadworks` | boolean | no | Por defecto `true` |
| `include` | array de enum | no | `pois`, `fuel`, `weather` |

Los nombres de lugar se resuelven por `/api/geocode` tomando el primer candidato. Si un
nombre no resuelve, la llamada falla indicando cuál y sugiriendo `geocode_place`.

Salida: distancia total, duración estimada, lista de tramos con distancia y tiempo,
peajes y ferries detectados, los extras solicitados, y `web_url`.

No devuelve la geometría de la ruta. Son miles de coordenadas que no aportan nada a un
agente y consumirían su contexto; para verla está el enlace.

### `geocode_place`

Entrada: `query` (string). Salida: hasta cinco candidatos con etiqueta y coordenadas.
Sirve para desambiguar antes de llamar a `plan_route`.

## Enlace a la web

Formato:

```
{PUBLIC_WEB_URL}/?wp=lng,lat,perfil,nombre;lng,lat,perfil,nombre&rt=0
```

- `wp`: waypoints separados por `;`. Cada uno es `lng,lat,perfil,nombre`.
- El nombre es opcional y va codificado con `encodeURIComponent`.
- `rt`: `1` si es circuito.

Se elige un enlace autocontenido en lugar de rutas guardadas con identificador: no añade
estado, no caduca, y se puede compartir por mensajería.

## Cambio en el frontend

Al montar `App`, leer `location.search`, parsear los waypoints y poblar el estado. El
`useEffect` de routing que ya existe recalcula solo.

Reglas:

- Si el parámetro falta o es inválido, se ignora y la aplicación arranca vacía. Un enlace
  mal formado nunca debe romper la web.
- Los perfiles desconocidos caen al valor por defecto.
- Solo lectura al cargar. No se sincroniza la URL mientras se editan waypoints: eso es
  otra funcionalidad y otro riesgo de bucles de actualización.
- La URL se conserva tras cargar, para que recargar la página reproduzca la ruta.

El parseo vive en un módulo propio del frontend, sin dependencias de React, para poder
probarlo aislado.

## Configuración

Toda por entorno, centralizada en `mcp/src/config.ts` siguiendo el patrón de
`backend/src/config.ts`. Ningún otro módulo lee `process.env`.

| Variable | Por defecto | Uso |
|---|---|---|
| `MCP_PORT` | `8081` | Puerto de escucha en el contenedor |
| `MCP_HOST` | `127.0.0.1` | En Docker se fija a `0.0.0.0` |
| `BACKEND_URL` | `http://127.0.0.1:8080` | API del backend |
| `PUBLIC_WEB_URL` | `http://127.0.0.1:9640` | Base de los enlaces devueltos |
| `ROUTE_TIMEOUT_MS` | `180000` | Límite por llamada al backend |

Además, dos variables que solo consume el `docker-compose.server.yml`, no el servidor:
`MCP_BIND` (dirección de publicación, `192.168.65.9` en el servidor) y `MCP_PORT_HOST`
(puerto publicado, `9641`).

Los valores inválidos abortan el arranque con un mensaje explícito, en lugar de fallar
más tarde en la primera petición.

## Despliegue

Cuarto servicio del `docker-compose.server.yml`:

- `Dockerfile.mcp`, multi-stage, `USER node` en la etapa final.
- Publicado en `${MCP_BIND}:${MCP_PORT_HOST:-9641}:8081`, con la IP concreta como
  destino de binding y nunca `0.0.0.0`.
- `depends_on` del backend en estado saludable.
- Healthcheck: petición JSON-RPC `initialize` real contra `/mcp`.
- `no-new-privileges`, política de reinicio y rotación de logs, como el resto.
- Sin autenticación: servicio interno de LAN, igual criterio que Obscura.

Configuración del agente:

```
name: motorrad-routenplaner
url: http://192.168.65.9:9641/mcp
transport: http
```

## Errores

El MCP traduce fallos del backend a mensajes accionables:

| Situación | Respuesta al agente |
|---|---|
| Punto fuera de la cobertura de tiles | Indica que solo hay datos de Iberia y el sur de Francia |
| Nombre de lugar sin resultados | Nombra el punto que falló y sugiere `geocode_place` |
| Menos de dos puntos o más de diez | Explica el límite y por qué existe |
| Backend caído o agotado el tiempo | Distingue «no disponible» de «tarda demasiado» |
| Overpass saturado | Indica que los extras no están disponibles, sin invalidar la ruta |

El caso de la cobertura es el más probable en la práctica: los tiles descargados cubren
la península ibérica y el sur de Francia, y BRouter falla de forma opaca fuera de ahí.

## Pruebas

El proyecto no tiene framework de tests y la política es agotar la biblioteca estándar
antes de añadir dependencias, así que se usa `node --test`, nativo.

Cobertura de pruebas unitarias, sobre lógica pura:

- Construcción del enlace: waypoints con y sin nombre, nombres con caracteres que
  requieren codificación, circuito, perfiles por tramo.
- Parseo del enlace en el frontend: entrada válida, vacía, malformada, perfil
  desconocido, coordenadas no numéricas.
- Validación de argumentos de `plan_route`: límites de número de puntos, perfiles
  inválidos, longitud de `profiles` que no cuadra con los tramos.

Validación de extremo a extremo, manual y documentada en la wiki:

1. `initialize` por JSON-RPC contra `http://192.168.65.9:9641/mcp`.
2. `tools/list` devuelve las dos herramientas.
3. `plan_route` de Bilbao a Jaca en perfil curvo devuelve distancia coherente y enlace.
4. Abrir el enlace en el navegador reproduce la ruta en el mapa.
5. Una ruta con destino en Alemania devuelve el error de cobertura, no un 502.

## Fuera de alcance

- `export_gpx`: el enlace lleva a la web, que ya exporta con un clic.
- Herramienta suelta de consulta de obras: `plan_route` ya las evita.
- Sincronizar la URL mientras se editan waypoints.
- Empaquetar el MCP en el ejecutable de Windows.
- Autenticación del MCP: es un servicio de LAN, igual criterio que el resto.

## Riesgos y limitaciones conocidas

**Latencia por tramo.** El backend calcula cada tramo por separado y además pide dos
alternativas, así que una ruta de N waypoints supone `(N-1) × 3` llamadas secuenciales a
BRouter. De ahí el límite de diez puntos y el tiempo de espera amplio. Si resulta molesto,
la mejora natural es un parámetro en `/api/route` para omitir las alternativas; queda
fuera de esta entrega.

**Acoplamiento de tipos.** El MCP reutiliza los tipos de `backend/src/types.ts`. Es
deliberado: un cambio incompatible en la API rompe el build del MCP en lugar de romperse
en producción.

**Cobertura de datos.** Ampliar el radio de uso exige descargar más tiles `.rd5`. El
mensaje de error debe dejarlo claro para que la causa sea obvia.
