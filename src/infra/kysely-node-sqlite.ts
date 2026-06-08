// Build-only Kysely dialect for Node's node:sqlite API.
import type {
  DatabaseIntrospector,
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
} from "kysely";
import { DummyDriver, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";

/** Build-only Kysely dialect: compiles queries for the sync helpers in `kysely-sync.ts`.
 *  Execution never goes through Kysely's async driver — `executeSqliteQuerySync` runs the
 *  compiled SQL directly against node:sqlite — so a DummyDriver is sufficient. */
export class NodeSqliteKyselyDialect implements Dialect {
  createDriver(): Driver {
    return new DummyDriver();
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}
