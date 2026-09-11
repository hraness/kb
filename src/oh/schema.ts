import { Database } from "bun:sqlite";
import { canonicalJson } from "@hraness/oh";
import { applyOhSqliteMigrations } from "@hraness/oh/sqlite";
import { GraphAuthorityError } from "../graph-authority-model";

type SchemaEntry = Readonly<{ type: string; name: string; tbl_name: string; sql: string | null;
  nameLength: number; tableNameLength: number; sqlLength: number | null }>;
const MAXIMUM_SCHEMA_ENTRIES = 256;
const MAXIMUM_SCHEMA_SQL_LENGTH = 16_384;
let expectedSchema: string | undefined;

function schemaEntries(database: Database): SchemaEntry[] {
  // Only SQLite's own catalog is read before its named objects are authenticated.
  // Bound both the row count and text copied out of a potentially hostile cache.
  const entries = database.query<SchemaEntry, []>(`SELECT type,
    substr(name, 1, 257) AS name, length(name) AS nameLength,
    substr(tbl_name, 1, 257) AS tbl_name, length(tbl_name) AS tableNameLength,
    substr(sql, 1, ${MAXIMUM_SCHEMA_SQL_LENGTH + 1}) AS sql, length(sql) AS sqlLength
    FROM main.sqlite_schema LIMIT ${MAXIMUM_SCHEMA_ENTRIES + 1}`).all();
  if (entries.length > MAXIMUM_SCHEMA_ENTRIES || entries.some(entry => entry.nameLength > 256
    || entry.tableNameLength > 256 || (entry.sqlLength ?? 0) > MAXIMUM_SCHEMA_SQL_LENGTH)) {
    throw new GraphAuthorityError("corrupt-cache", "Graph cache schema exceeds its metadata bounds.");
  }
  return entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.type < b.type ? -1 : 1);
}

/** Reject altered tables, virtual tables, indexes, foreign views and triggers before any data query or migration. */
export function validateOhCacheSchema(database: Database): boolean {
  const entries = schemaEntries(database);
  if (entries.length === 0) return false;
  if (expectedSchema === undefined) {
    const trusted = new Database(":memory:", { strict: true });
    try {
      applyOhSqliteMigrations(trusted);
      expectedSchema = canonicalJson(schemaEntries(trusted));
    } finally { trusted.close(); }
  }
  if (canonicalJson(entries) !== expectedSchema) throw new GraphAuthorityError("corrupt-cache", "Graph cache schema differs from the pinned Oh schema; rebuild it from Markdown.");
  return true;
}
