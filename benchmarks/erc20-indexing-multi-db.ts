import { run, bench, summary, boxplot } from "mitata";
import { BunSQLiteDatabase, drizzle as drizzleSqlite } from "drizzle-orm/bun-sqlite";
import { NodePgDatabase, drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Database } from "bun:sqlite";
import { Client } from "pg";
import { sqliteTable, text, real } from "drizzle-orm/sqlite-core";
import { pgTable, text as pgText, real as pgReal } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { drizzow as drizzowSqlite } from "../src/bun-sqlite";
import { drizzow as drizzowPg } from "../src/node-postgres";

// Define schema for SQLite
const sqliteAccounts = sqliteTable("accounts", {
  address: text("address").primaryKey(),
  balance: real("balance").notNull().default(0),
});

// Define schema for PostgreSQL
const pgAccounts = pgTable("accounts", {
  address: pgText("address").primaryKey(),
  balance: pgReal("balance").notNull().default(0),
});

// Generate random ERC20 transfer events
interface TransferEvent {
  from: string;
  to: string;
  value: number;
}

function generateAddress(index: number): string {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function generateTransferEvents(
  count: number,
  uniqueAddresses: number,
): TransferEvent[] {
  const events: TransferEvent[] = [];

  for (let i = 0; i < count; i++) {
    const from = generateAddress(Math.floor(Math.random() * uniqueAddresses));
    const to = generateAddress(Math.floor(Math.random() * uniqueAddresses));
    const value = Math.floor(Math.random() * 1000) + 1;

    events.push({ from, to, value });
  }

  return events;
}

// Setup SQLite database
function setupSqliteDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzleSqlite(sqlite, { schema: { accounts: sqliteAccounts } });

  // Create table
  db.run(`
    CREATE TABLE accounts (
      address TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0
    )
  `);

  return { sqlite, db };
}

// Setup PostgreSQL database
async function setupPostgresDatabase() {
  const client = new Client({
    connectionString: process.env.PG_TEST_DB_URL || "postgresql://postgres:postgres@localhost:5432/test",
  });
  await client.connect();
  
  const db = drizzlePg(client, { schema: { accounts: pgAccounts } });

  // Create table
  await client.query(`
    DROP TABLE IF EXISTS accounts;
    CREATE TABLE accounts (
      address TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0
    )
  `);

  return { client, db };
}

// SQLite UoW implementation
async function sqliteUowIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof sqliteAccounts }>,
  events: TransferEvent[],
) {
  const uow = drizzowSqlite(db);

  for (const event of events) {
    // Handle sender (from)
    if (event.from !== "0x0000000000000000000000000000000000000000") {
      let sender = await uow.accounts.find({
        address: event.from,
      });

      if (!sender) {
        sender = uow.accounts.create({
          address: event.from,
          balance: 0,
        });
      }

      sender.balance -= event.value;
    }

    // Handle receiver (to)
    if (event.to !== "0x0000000000000000000000000000000000000000") {
      let receiver = await uow.accounts.find({
        address: event.to,
      });

      if (!receiver) {
        receiver = uow.accounts.create({
          address: event.to,
          balance: 0,
        });
      }

      receiver.balance += event.value;
    }
  }

  await uow.save();
}

// PostgreSQL UoW implementation
async function pgUowIndexing(
  db: NodePgDatabase<{ accounts: typeof pgAccounts }>,
  events: TransferEvent[],
) {
  const uow = drizzowPg(db);

  for (const event of events) {
    // Handle sender (from)
    if (event.from !== "0x0000000000000000000000000000000000000000") {
      let sender = await uow.accounts.find({
        address: event.from,
      });

      if (!sender) {
        sender = uow.accounts.create({
          address: event.from,
          balance: 0,
        });
      }

      sender.balance -= event.value;
    }

    // Handle receiver (to)
    if (event.to !== "0x0000000000000000000000000000000000000000") {
      let receiver = await uow.accounts.find({
        address: event.to,
      });

      if (!receiver) {
        receiver = uow.accounts.create({
          address: event.to,
          balance: 0,
        });
      }

      receiver.balance += event.value;
    }
  }

  await uow.save();
}

// SQLite Vanilla implementation
async function sqliteVanillaIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof sqliteAccounts }>,
  events: TransferEvent[],
) {
  // Process each event individually
  for (const event of events) {
    await db.transaction(async (tx) => {
      // Handle sender (from)
      if (event.from !== "0x0000000000000000000000000000000000000000") {
        await tx
          .insert(sqliteAccounts)
          .values({ address: event.from, balance: 0 })
          .onConflictDoUpdate({
            target: sqliteAccounts.address,
            set: {
              balance: sql`${sqliteAccounts.balance} - ${event.value}`,
            },
          });
      }

      // Handle receiver (to)
      if (event.to !== "0x0000000000000000000000000000000000000000") {
        await tx
          .insert(sqliteAccounts)
          .values({ address: event.to, balance: event.value })
          .onConflictDoUpdate({
            target: sqliteAccounts.address,
            set: {
              balance: sql`${sqliteAccounts.balance} + ${event.value}`,
            },
          });
      }
    });
  }
}

// PostgreSQL Vanilla implementation
async function pgVanillaIndexing(
  db: NodePgDatabase<{ accounts: typeof pgAccounts }>,
  events: TransferEvent[],
) {
  // Process each event individually
  for (const event of events) {
    await db.transaction(async (tx) => {
      // Handle sender (from)
      if (event.from !== "0x0000000000000000000000000000000000000000") {
        await tx
          .insert(pgAccounts)
          .values({ address: event.from, balance: 0 })
          .onConflictDoUpdate({
            target: pgAccounts.address,
            set: {
              balance: sql`${pgAccounts.balance} - ${event.value}`,
            },
          });
      }

      // Handle receiver (to)
      if (event.to !== "0x0000000000000000000000000000000000000000") {
        await tx
          .insert(pgAccounts)
          .values({ address: event.to, balance: event.value })
          .onConflictDoUpdate({
            target: pgAccounts.address,
            set: {
              balance: sql`${pgAccounts.balance} + ${event.value}`,
            },
          });
      }
    });
  }
}

// Check if PostgreSQL is available
async function isPostgresAvailable(): Promise<boolean> {
  if (!process.env.PG_TEST_DB_URL) {
    return false;
  }
  
  try {
    const client = new Client({
      connectionString: process.env.PG_TEST_DB_URL,
    });
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

// Run benchmarks
export default async function() {
  console.log("🚀 ERC20 Transfer Events Indexing Benchmark (Multi-DB)\\n");

  const pgAvailable = await isPostgresAvailable();
  if (!pgAvailable) {
    console.log("⚠️  PostgreSQL not available. Set PG_TEST_DB_URL to enable PostgreSQL benchmarks.\\n");
  }

  // SQLite benchmarks
  console.log("📊 SQLite Benchmarks\\n");
  
  boxplot(() => {
    summary(() => {
      bench(
        "SQLite UoW - $events events ($addresses addresses)",
        async function* (state: any) {
          const eventCount = state.get("events");
          const addressCount = state.get("addresses");
          const events = generateTransferEvents(eventCount, addressCount);

          yield async () => {
            const { db } = setupSqliteDatabase();
            await sqliteUowIndexing(db, events);
          };
        },
      ).args({ events: [100, 500, 1000], addresses: [200, 500, 1000] });

      bench(
        "SQLite Vanilla - $events events ($addresses addresses)",
        async function* (state: any) {
          const eventCount = state.get("events");
          const addressCount = state.get("addresses");
          const events = generateTransferEvents(eventCount, addressCount);

          yield async () => {
            const { db } = setupSqliteDatabase();
            await sqliteVanillaIndexing(db, events);
          };
        },
      ).args({ events: [100, 500, 1000], addresses: [200, 500, 1000] });
    });
  });

  // PostgreSQL benchmarks (if available)
  if (pgAvailable) {
    console.log("\\n📊 PostgreSQL Benchmarks\\n");
    
    boxplot(() => {
      summary(() => {
        bench(
          "PostgreSQL UoW - $events events ($addresses addresses)",
          async function* (state: any) {
            const eventCount = state.get("events");
            const addressCount = state.get("addresses");
            const events = generateTransferEvents(eventCount, addressCount);

            yield async () => {
              const { db, client } = await setupPostgresDatabase();
              try {
                await pgUowIndexing(db, events);
              } finally {
                await client.end();
              }
            };
          },
        ).args({ events: [100, 500, 1000], addresses: [200, 500, 1000] });

        bench(
          "PostgreSQL Vanilla - $events events ($addresses addresses)",
          async function* (state: any) {
            const eventCount = state.get("events");
            const addressCount = state.get("addresses");
            const events = generateTransferEvents(eventCount, addressCount);

            yield async () => {
              const { db, client } = await setupPostgresDatabase();
              try {
                await pgVanillaIndexing(db, events);
              } finally {
                await client.end();
              }
            };
          },
        ).args({ events: [100, 500, 1000], addresses: [200, 500, 1000] });
      });
    });
  }

  // Focused performance tests
  console.log("\\n📊 Focused Performance Tests\\n");

  summary(() => {
    // SQLite focused tests
    bench("SQLite High Reuse - UoW", async function* () {
      const events = generateTransferEvents(1000, 100); // 1000 events, only 100 unique addresses

      yield async () => {
        const { db } = setupSqliteDatabase();
        await sqliteUowIndexing(db, events);
      };
    });

    bench("SQLite High Reuse - Vanilla", async function* () {
      const events = generateTransferEvents(1000, 100); // 1000 events, only 100 unique addresses

      yield async () => {
        const { db } = setupSqliteDatabase();
        await sqliteVanillaIndexing(db, events);
      };
    });

    // PostgreSQL focused tests (if available)
    if (pgAvailable) {
      bench("PostgreSQL High Reuse - UoW", async function* () {
        const events = generateTransferEvents(1000, 100); // 1000 events, only 100 unique addresses

        yield async () => {
          const { db, client } = await setupPostgresDatabase();
          try {
            await pgUowIndexing(db, events);
          } finally {
            await client.end();
          }
        };
      });

      bench("PostgreSQL High Reuse - Vanilla", async function* () {
        const events = generateTransferEvents(1000, 100); // 1000 events, only 100 unique addresses

        yield async () => {
          const { db, client } = await setupPostgresDatabase();
          try {
            await pgVanillaIndexing(db, events);
          } finally {
            await client.end();
          }
        };
      });
    }
  });

  await run();
}