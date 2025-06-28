import { run, bench, summary, boxplot } from "mitata";
import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { eq, sql } from "drizzle-orm";
import { createUow } from "../src/bun-sqlite";

// Define schema for accounts
const accounts = sqliteTable("accounts", {
  address: text("address").primaryKey(),
  balance: real("balance").notNull().default(0),
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
  uniqueAddresses: number
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

// Setup database
function setupDatabase() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema: { accounts } });

  // Create table
  db.run(`
    CREATE TABLE accounts (
      address TEXT PRIMARY KEY,
      balance REAL NOT NULL DEFAULT 0
    )
  `);

  return { sqlite, db };
}

// Vanilla Drizzle implementation - one transaction per event (like Ponder)
async function vanillaDrizzleIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof accounts }>,
  events: TransferEvent[]
) {
  for (const event of events) {
    // Each event is processed in its own transaction
    await db.transaction(async (tx: any) => {
      // Handle sender (from)
      if (event.from !== "0x0000000000000000000000000000000000000000") {
        const sender = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.address, event.from))
          .limit(1);

        if (sender.length > 0) {
          await tx
            .update(accounts)
            .set({ balance: sender[0].balance - event.value })
            .where(eq(accounts.address, event.from));
        } else {
          await tx.insert(accounts).values({
            address: event.from,
            balance: -event.value,
          });
        }
      }

      // Handle receiver (to)
      if (event.to !== "0x0000000000000000000000000000000000000000") {
        const receiver = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.address, event.to))
          .limit(1);

        if (receiver.length > 0) {
          await tx
            .update(accounts)
            .set({ balance: receiver[0].balance + event.value })
            .where(eq(accounts.address, event.to));
        } else {
          await tx.insert(accounts).values({
            address: event.to,
            balance: event.value,
          });
        }
      }
    });
  }
}

// UoW implementation
async function uowIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof accounts }>,
  events: TransferEvent[]
) {
  const uow = createUow(db);

  // Track accounts we've already seen in this batch
  const seenAccounts = new Map<string, typeof accounts.$inferSelect>();

  for (const event of events) {
    // Handle sender (from)
    if (event.from !== "0x0000000000000000000000000000000000000000") {
      let sender = seenAccounts.get(event.from);

      if (!sender) {
        sender = await uow.accounts.findFirst({
          where: eq(accounts.address, event.from),
        });

        if (!sender) {
          sender = uow.accounts.create({
            address: event.from,
            balance: 0,
          });
        }

        seenAccounts.set(event.from, sender);
      }

      sender.balance -= event.value;
    }

    // Handle receiver (to)
    if (event.to !== "0x0000000000000000000000000000000000000000") {
      let receiver = seenAccounts.get(event.to);

      if (!receiver) {
        receiver = await uow.accounts.findFirst({
          where: eq(accounts.address, event.to),
        });

        if (!receiver) {
          receiver = uow.accounts.create({
            address: event.to,
            balance: 0,
          });
        }

        seenAccounts.set(event.to, receiver);
      }

      receiver.balance += event.value;
    }
  }

  await uow.save();
}

// Optimized vanilla Drizzle with batch operations
async function vanillaDrizzleBatchIndexing(
  db: BunSQLiteDatabase<{ accounts: typeof accounts }>,
  events: TransferEvent[]
) {
  // Aggregate balance changes
  const balanceChanges = new Map<string, number>();

  for (const event of events) {
    if (event.from !== "0x0000000000000000000000000000000000000000") {
      balanceChanges.set(
        event.from,
        (balanceChanges.get(event.from) || 0) - event.value
      );
    }
    if (event.to !== "0x0000000000000000000000000000000000000000") {
      balanceChanges.set(
        event.to,
        (balanceChanges.get(event.to) || 0) + event.value
      );
    }
  }

  // Get all addresses
  const addresses = Array.from(balanceChanges.keys());

  // Fetch existing accounts
  const existingAccounts = await db
    .select()
    .from(accounts)
    .where(
      sql`address IN (${sql.join(
        addresses.map((a) => sql`${a}`),
        sql`, `
      )})`
    );

  const existingAddresses = new Set(
    existingAccounts.map((a: any) => a.address)
  );

  // Prepare inserts and updates
  const inserts: any[] = [];
  const updates: any[] = [];

  for (const [address, change] of balanceChanges) {
    if (existingAddresses.has(address)) {
      const account = existingAccounts.find((a: any) => a.address === address);
      updates.push({
        address,
        balance: account!.balance + change,
      });
    } else {
      inserts.push({
        address,
        balance: change,
      });
    }
  }

  // Execute batch operations
  if (inserts.length > 0) {
    await db.insert(accounts).values(inserts);
  }

  // Update existing accounts one by one (SQLite doesn't support bulk updates well)
  for (const update of updates) {
    await db
      .update(accounts)
      .set({ balance: update.balance })
      .where(eq(accounts.address, update.address));
  }
}

// Run benchmarks
console.log("🚀 ERC20 Transfer Events Indexing Benchmark\n");

boxplot(() => {
  summary(() => {
    bench(
      "Vanilla Drizzle (1 tx/event) - $events events ($addresses addresses)",
      async function* (state: any) {
        const eventCount = state.get("events");
        const addressCount = state.get("addresses");
        const events = generateTransferEvents(eventCount, addressCount);

        yield async () => {
          const { db } = setupDatabase();
          await vanillaDrizzleIndexing(db, events);
        };
      }
    ).args({ events: [10, 50, 100], addresses: [20, 50, 100] });

    bench(
      "UoW (1 tx total) - $events events ($addresses addresses)",
      async function* (state: any) {
        const eventCount = state.get("events");
        const addressCount = state.get("addresses");
        const events = generateTransferEvents(eventCount, addressCount);

        yield async () => {
          const { db } = setupDatabase();
          await uowIndexing(db, events);
        };
      }
    ).args({ events: [10, 50, 100], addresses: [20, 50, 100] });

    bench(
      "Vanilla Batch - $events events ($addresses addresses)",
      async function* (state: any) {
        const eventCount = state.get("events");
        const addressCount = state.get("addresses");
        const events = generateTransferEvents(eventCount, addressCount);

        yield async () => {
          const { db } = setupDatabase();
          await vanillaDrizzleBatchIndexing(db, events);
        };
      }
    ).args({ events: [10, 50, 100], addresses: [20, 50, 100] });
  });
});

// Additional focused benchmarks
console.log("\n📊 Focused Performance Tests\n");

summary(() => {
  // Test with high address reuse (simulating popular tokens)
  bench("High Reuse - Vanilla Drizzle", async function* () {
    const events = generateTransferEvents(100, 10); // 100 events, only 10 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await vanillaDrizzleIndexing(db, events);
    };
  });

  bench("High Reuse - UoW", async function* () {
    const events = generateTransferEvents(100, 10); // 100 events, only 10 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await uowIndexing(db, events);
    };
  });

  // Test with low address reuse (simulating new token)
  bench("Low Reuse - Vanilla Drizzle", async function* () {
    const events = generateTransferEvents(100, 100); // 100 events, 100 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await vanillaDrizzleIndexing(db, events);
    };
  });

  bench("Low Reuse - UoW", async function* () {
    const events = generateTransferEvents(100, 100); // 100 events, 100 unique addresses

    yield async () => {
      const { db } = setupDatabase();
      await uowIndexing(db, events);
    };
  });
});

// Memory usage comparison
console.log("\n💾 Memory Usage Analysis\n");

summary(() => {
  bench("Memory - Vanilla (1000 events)", async function* () {
    const events = generateTransferEvents(1000, 200);

    yield async () => {
      const { db } = setupDatabase();
      await vanillaDrizzleIndexing(db, events);
    };
  }).gc("inner");

  bench("Memory - UoW (1000 events)", async function* () {
    const events = generateTransferEvents(1000, 200);

    yield async () => {
      const { db } = setupDatabase();
      await uowIndexing(db, events);
    };
  }).gc("inner");
});

await run();
