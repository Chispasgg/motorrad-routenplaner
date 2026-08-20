# Rutas guardadas en SQLite

**Fecha:** 2026-08-20
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Guardar rutas para volver a cargarlas más tarde. Se conserva lo necesario para
reproducirlas —los puntos con su nombre y el perfil de cada tramo— junto a la fecha de la
última modificación. Un apartado de la barra lateral las lista y permite cargarlas,
renombrarlas, duplicarlas y borrarlas.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Motor | `node:sqlite` de la biblioteca estándar |
| Ubicación de los datos | Fichero en un volumen persistente del backend |
| Forma de los waypoints | JSON en una columna, no tabla aparte |
| Nombre al guardar | Propuesto a partir de los puntos y editable antes de confirmar |
| Guardar sobre una cargada | Actualiza esa misma y refresca su fecha; hay «guardar como nueva» aparte |
| Acciones en la lista | Cargar, renombrar, duplicar, borrar |
| Duplicar | Sin endpoint propio: obtener y crear |
| Si la base de datos falla | El resto de la aplicación sigue funcionando |

`node:sqlite` está verificado en `node:22-slim`, la imagen de los contenedores: funciona sin
necesidad de ningún indicador y sin dependencias nuevas.

## Esquema

```sql
CREATE TABLE IF NOT EXISTS routes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  round_trip INTEGER NOT NULL DEFAULT 0,
  waypoints  TEXT    NOT NULL
);
```

`waypoints` guarda un JSON con la lista de `{ lng, lat, label, profile }`. Se elige JSON
porque la ruta siempre se lee completa: no existe ninguna consulta por waypoint
individual, así que normalizar añadiría una tabla y un join sin beneficio.

Las fechas se guardan en ISO 8601 y en UTC. `created_at` no cambia nunca; `updated_at` se
refresca en cada actualización.

## API

| Método y ruta | Uso |
|---|---|
| `GET /api/routes` | Lista con id, nombre, fechas, si es circuito y número de puntos |
| `GET /api/routes/:id` | Ruta completa, con sus waypoints |
| `POST /api/routes` | Crear; devuelve la ruta creada |
| `PUT /api/routes/:id` | Actualizar nombre, waypoints o ambos; refresca `updated_at` |
| `DELETE /api/routes/:id` | Borrar |

La lista no incluye los waypoints, para que crecer en número de rutas no engorde la
respuesta. Duplicar se resuelve en el frontend con `GET /api/routes/:id` seguido de
`POST /api/routes`, añadiendo un sufijo al nombre. Así el backend no gana un endpoint que
no aporta lógica propia.

Validación en el servidor: el nombre no puede estar vacío ni pasar de 120 caracteres, hacen
falta al menos dos waypoints, cada uno con coordenadas dentro de rango y un perfil válido.
El frontend valida también, pero el servidor no confía en él.

## Componentes

| Fichero | Responsabilidad |
|---|---|
| `backend/src/services/routeStore.ts` | Único módulo que conoce SQLite: esquema y operaciones |
| `backend/src/config.ts` | Ruta del fichero de base de datos |
| `backend/src/index.ts` | Los cinco endpoints |
| `frontend/src/routeName.ts` | Nombre propuesto a partir de los waypoints |
| `frontend/src/api/client.ts` | Cliente de los cinco endpoints |
| `frontend/src/components/Sidebar.tsx` | Botón de guardar y tarjeta de rutas guardadas |
| `frontend/src/App.tsx` | Estado de la lista, ruta cargada y operaciones |
| `frontend/src/i18n.tsx` | Textos en los tres idiomas |
| `frontend/src/index.css` | Estilos de la fila de botones y de la lista |
| `docker-compose.server.yml` | Volumen persistente para la base de datos |

## Contrato del almacén

```ts
export interface StoredWaypoint {
  lng: number;
  lat: number;
  label: string;
  profile: ProfileName;
}

export interface StoredRouteSummary {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  roundTrip: boolean;
  pointCount: number;
}

export interface StoredRoute extends StoredRouteSummary {
  waypoints: StoredWaypoint[];
}

export interface RouteStore {
  list(): StoredRouteSummary[];
  get(id: number): StoredRoute | null;
  create(input: { name: string; roundTrip: boolean; waypoints: StoredWaypoint[] }): StoredRoute;
  update(id: number, patch: { name?: string; roundTrip?: boolean; waypoints?: StoredWaypoint[] }): StoredRoute | null;
  remove(id: number): boolean;
}
```

`get`, `update` y `remove` devuelven `null` o `false` cuando el identificador no existe, en
lugar de lanzar: la ausencia es un resultado esperado, no un fallo.

## Interfaz

**Guardar.** Junto al botón de exportar GPX, al final de la barra lateral, en la misma
fila. Al pulsarlo aparece en línea un campo con el nombre propuesto, editable, con
confirmar y cancelar. Si la ruta actual proviene de una guardada, el botón actualiza esa
misma y aparece además «guardar como nueva». Sin ventanas modales: el proyecto no usa
ninguna y su patrón es todo en línea en la barra lateral.

**Lista.** Tarjeta plegable «Rutas guardadas», con el mismo aspecto que las de obras o
restaurantes. Cada entrada muestra el nombre, la fecha de última modificación y el número
de puntos, con las cuatro acciones. Borrar pide confirmación en línea, porque es
irreversible.

**Cargar.** Rellena los waypoints y el indicador de circuito, y el efecto de recálculo que
ya existe se encarga del resto. Es el mismo camino que usan los enlaces del servidor MCP,
así que no aparece lógica de routing nueva.

## Errores

| Situación | Comportamiento |
|---|---|
| La base de datos no se puede abrir | Los endpoints de rutas responden 503 con un motivo; el resto de la aplicación funciona igual |
| Nombre vacío o demasiado largo | 400 con explicación; el botón de confirmar queda inhabilitado en el frontend |
| Menos de dos waypoints | 400: no hay ruta que guardar |
| Identificador inexistente | 404, y la lista se refresca para reflejar la realidad |
| Fallo de red al listar | La tarjeta muestra el error y ofrece reintentar, sin vaciar lo ya mostrado |

Que un problema de disco no tumbe el backend es deliberado: planificar rutas es la función
principal y guardarlas es secundaria.

## Pruebas

Unitarias de `routeStore`, con base de datos en fichero temporal:

- Crear y recuperar, comprobando que el JSON de waypoints sobrevive intacto.
- Listar devuelve resumen sin waypoints y con el número de puntos correcto.
- Actualizar refresca `updated_at` y **deja `created_at` intacto**.
- Actualizar solo el nombre no toca los waypoints, y viceversa.
- Borrar devuelve verdadero una vez y falso la segunda.
- Identificador inexistente devuelve `null` en lugar de lanzar.
- Nombre vacío, nombre de más de 120 caracteres y menos de dos waypoints se rechazan.
- Perfil no válido o coordenada fuera de rango se rechazan.

Unitarias del nombre propuesto: dos puntos, varios puntos, circuito, nombres largos que hay
que recortar, y waypoints sin etiqueta.

De extremo a extremo contra el despliegue: guardar una ruta, comprobar que aparece en la
lista, cargarla en otra pestaña, actualizarla y ver cambiar la fecha, duplicarla, borrarla,
y confirmar que sobrevive a reiniciar el contenedor.

## Riesgos

**`node:sqlite` es API experimental** y puede cambiar entre versiones de Node. Está
encapsulada en un único módulo para que un cambio afecte a un solo fichero. El aviso de
característica experimental aparecerá en los registros del contenedor.

**La API es sincrónica** y bloquea el bucle de eventos mientras consulta. Con un usuario y
consultas triviales es irrelevante; conviene no meter ahí consultas costosas más adelante.

**El volumen es nuevo**, así que hay que crear el directorio con los permisos adecuados:
el contenedor del backend corre como usuario sin privilegios y necesita poder escribir.
Este es el punto más probable de fallo en el primer despliegue.

## Fuera de alcance

- Que el servidor MCP guarde o liste rutas: hoy solo la interfaz web escribe en el almacén.
- Guardar la geometría calculada: se guardan los puntos y la ruta se recalcula al cargar.
- Carpetas, etiquetas o búsqueda en la lista.
- Compartir rutas entre usuarios o exportar el almacén completo.
- Historial de versiones de una ruta.
