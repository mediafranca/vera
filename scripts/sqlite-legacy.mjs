// Electron 32 es el último Electron que corre en macOS Catalina, pero trae
// Node 20 y por tanto no incluye `node:sqlite`. `better-sqlite3` implementa la
// pequeña superficie síncrona que Vera usa (Database, Statement, exec/close).
// El alias se activa sólo en el build legacy; la distribución contemporánea
// sigue usando el módulo nativo de Node.
import BetterSqlite3 from 'better-sqlite3';

export const DatabaseSync = BetterSqlite3;
