import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import type { Database } from "bun:sqlite";
import type { RelationalQueryBuilder } from "drizzle-orm/sqlite-core/query-builders/query";
import type {
  DrizzleTypeError,
  ExtractTablesWithRelations,
  InferInsertModel,
  InferModelFromColumns,
  Table,
  TablesRelationalConfig,
} from "drizzle-orm";

declare function createUow<
  FullSchema extends Record<string, Table>,
  Schema extends TablesRelationalConfig = ExtractTablesWithRelations<FullSchema>
>(
  db: BunSQLiteDatabase<FullSchema> & {
    $client: Database;
  }
): Schema extends Record<string, never>
  ? DrizzleTypeError<"Seems like the schema generic is missing - did you forget to add it to your DB type?">
  : {
      [K in keyof Schema]: K extends keyof FullSchema
        ? RelationalQueryBuilder<"sync", FullSchema, Schema, Schema[K]> & {
            create: (
              v: InferInsertModel<FullSchema[K]>
            ) => InferModelFromColumns<Schema[K]["columns"]>;
          }
        : never;
    } & {
      save: () => Promise<void>;
      setCheckpoint: () => number;
      rollback: (checkpoint: number) => {
        error: string;
      };
    };

const db = drizzle({ schema });

const uow = createUow(db);

// implements drizzle's `query` API by passing through to underlying drizzle object and wrapping objects returned in proxies
// const users = await uow.users.findMany();
const user = await uow.users.findFirst();

if (user) {
  user.username = "cool_new_username"; // uow keeps track of changes using javascript proxies
}

const newUser = uow.users.create({
  username: "new_user",
});

await uow.save(); // computes a changeset, builds queries, and persists to the database

const checkpoint = uow.setCheckpoint();

// ... do changes

const result = uow.rollback(checkpoint); // rollback to a certain checkpoint in-memory

if (result.error) {
  console.log(result.error);
}
