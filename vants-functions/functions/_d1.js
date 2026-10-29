/* ============================================================
 * _d1.js · puente pg → Cloudflare D1 para las funciones VANTS
 * ------------------------------------------------------------
 * Todas las funciones del Worker hablaban con Postgres a traves
 * de pg (pool.query(sql, params) → { rows }). Con "todo en
 * Cloudflare" la base es D1 (SQLite): este modulo expone la
 * MISMA interfaz (crearSql(env.DB) → { query, run, db }) y
 * traduce al vuelo el dialecto:
 *   · $1..$n          → ? (reordenando los parametros por su
 *                        primera aparicion)
 *   · NOW()           → datetime('now')
 *   · ILIKE           → LIKE (LIKE ya es insensible a mayusculas
 *                        en SQLite para ASCII)
 *   · ::cast          → se elimina (SQLite no usa casts de PG)
 *   · GREATEST(a,b)   → MAX(a,b) (escalar de SQLite)
 *   · = ANY(ARRAY[...]) → IN (?,?,...)  (solo lo genera vantsdata;
 *                        alli se arregla en origen, esto es red
 *                        de seguridad)
 * RETURNING funciona igual en D1; los booleanos son 0/1 y los
 * timestamps TEXT ISO, como ya vive el esquema de vants-db.
 * ============================================================ */

const RE_PARAMS = /\$(\d+)/g;

function pgAD1(sql, params) {
  let texto = String(sql);

  // casts de Postgres: ::uuid, ::text, ::jsonb, ::int, ::int[]…
  texto = texto.replace(/::[a-zA-Z_][a-zA-Z0-9_]*(\[\])?/g, '');

  // = ANY(ARRAY[$1,$2]) → IN (?,?)
  texto = texto.replace(/=\s*ANY\(ARRAY\[((?:\$\d+(?:\s*,\s*\$\d+)*)?)\]\)/gi, (_m, lista) => {
    if (!lista) return 'IN (NULL)';
    return 'IN (' + lista.split(',').map(() => '?').join(',') + ')';
  });

  // GREATEST → MAX escalar de SQLite
  texto = texto.replace(/\bGREATEST\b/gi, 'MAX');

  // ILIKE → LIKE
  texto = texto.replace(/\bILIKE\b/gi, 'LIKE');

  // NOW() / now() → datetime('now')
  texto = texto.replace(/\bNOW\(\)/gi, "datetime('now')");

  // $n → ? con reorden de parametros por primera aparicion
  const orden = [];
  texto = texto.replace(RE_PARAMS, (_m, n) => {
    const idx = Number(n) - 1;
    let pos = orden.indexOf(idx);
    if (pos === -1) { orden.push(idx); pos = orden.length - 1; }
    return '?';
  });

  let valores = params;
  if (orden.length) {
    valores = orden.map((i) => params[i]);
    // seguridad: si una posicion pedida no vino en params, bind(undefined)
    // reventaria en D1; mejor null explicito.
    valores = valores.map((v) => (v === undefined ? null : v));
  }
  return { texto, valores };
}

export function crearSql(db) {
  if (!db) throw new Error('crearSql: falta el binding D1 (env.DB)');

  async function query(sql, params = []) {
    const { texto, valores } = pgAD1(sql, params);
    const esLectura = /^\s*(SELECT|WITH|VALUES|EXPLAIN)\b/i.test(texto) || /\bRETURNING\b/i.test(texto);
    if (esLectura) {
      const r = await db.prepare(texto).bind(...valores).all();
      const rows = r?.results ?? [];
      return { rows, rowCount: rows.length, meta: r?.meta ?? null };
    }
    const r = await db.prepare(texto).bind(...valores).run();
    return { rows: [], rowCount: (r?.meta && r.meta.changes) || 0, meta: r?.meta ?? null };
  }

  return {
    query,
    // alias por si algun port quiere semantica de escritura explicita
    run: query,
    db,
    // batch atomico de D1 (para las operaciones multi-paso de mm)
    batch: (sentencias) => db.batch(
      sentencias.map(({ sql, params }) => {
        const { texto, valores } = pgAD1(sql, params || []);
        return db.prepare(texto).bind(...valores);
      })
    ),
  };
}

/** @typedef {{ query: (sql: string, params?: unknown[]) => Promise<{rows: any[], rowCount: number, meta: any}>, run: typeof query, db: any, batch: (s: {sql: string, params?: unknown[]}[]) => Promise<any> }} Sql */
