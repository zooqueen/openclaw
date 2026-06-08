// Covers the build-only Kysely dialect and the sync helpers that execute its compiled queries.
import { DatabaseSync } from "node:sqlite";
import type { Generated } from "kysely";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  executeSqliteQuerySync,
  executeSqliteQueryTakeFirstSync,
  getNodeSqliteKysely,
} from "./kysely-sync.js";

type TestDatabase = {
  person: {
    id: Generated<number>;
    name: string;
  };
};

describe("NodeSqliteKyselyDialect", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    if (db) {
      clearNodeSqliteKyselyCacheForDatabase(db);
      db.close();
      db = undefined;
    }
  });

  it("compiles queries through the build-only dialect", () => {
    db = createPersonDb();
    const kysely = getNodeSqliteKysely<TestDatabase>(db);

    expect(kysely.insertInto("person").values({ name: "Ada" }).compile().sql).toBe(
      'insert into "person" ("name") values (?)',
    );
  });

  it("returns insert metadata only for changed insert statements", () => {
    db = createPersonDb();
    const kysely = getNodeSqliteKysely<TestDatabase>(db);

    const inserted = executeSqliteQuerySync(
      db,
      kysely.insertInto("person").values({ name: "Ada" }),
    );
    expect(inserted.insertId).toBe(1n);
    expect(inserted.numAffectedRows).toBe(1n);

    const updated = executeSqliteQuerySync(
      db,
      kysely.updateTable("person").set({ name: "Ada Lovelace" }).where("id", "=", 1),
    );
    expect(updated.insertId).toBeUndefined();
    expect(updated.numAffectedRows).toBe(1n);

    const ignored = executeSqliteQuerySync(
      db,
      kysely.insertInto("person").orIgnore().values({ id: 1, name: "Ada Again" }),
    );
    expect(ignored.insertId).toBeUndefined();
    expect(ignored.numAffectedRows).toBe(0n);

    const removed = executeSqliteQuerySync(db, kysely.deleteFrom("person").where("id", "=", 1));
    expect(removed.insertId).toBeUndefined();
    expect(removed.numAffectedRows).toBe(1n);
  });

  it("returns rows for select and insert-returning queries", () => {
    db = createPersonDb();
    const kysely = getNodeSqliteKysely<TestDatabase>(db);
    executeSqliteQuerySync(db, kysely.insertInto("person").values({ name: "Ada" }));

    const returned = executeSqliteQuerySync(
      db,
      kysely.insertInto("person").values({ name: "Grace" }).returning(["id", "name"]),
    ).rows;
    expect(returned).toEqual([{ id: 2, name: "Grace" }]);

    const rows = executeSqliteQuerySync(
      db,
      kysely.selectFrom("person").select(["id", "name"]).orderBy("id"),
    ).rows;
    expect(rows).toEqual([
      { id: 1, name: "Ada" },
      { id: 2, name: "Grace" },
    ]);

    const first = executeSqliteQueryTakeFirstSync(
      db,
      kysely.selectFrom("person").select(["id", "name"]).orderBy("id"),
    );
    expect(first).toEqual({ id: 1, name: "Ada" });
  });
});

function createPersonDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("create table person (id integer primary key autoincrement, name text not null)");
  return db;
}
