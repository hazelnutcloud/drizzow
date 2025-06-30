import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { drizzow } from "./index";

// Define your schema
const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  authorId: integer("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

async function example() {
  // Create PostgreSQL client
  const client = new Client({
    connectionString: process.env.DATABASE_URL || "postgresql://user:password@localhost:5432/mydb",
  });
  await client.connect();

  // Create Drizzle instance
  const db = drizzle(client, { schema: { users, posts } });

  // Create UnitOfWork with drizzow
  const uow = drizzow(db);

  try {
    // Create a new user
    const newUser = uow.users.create({
      name: "John Doe",
      email: "john@example.com",
    });
    console.log("Created user:", newUser);

    // Create a checkpoint
    const checkpoint1 = uow.setCheckpoint();

    // Modify the user
    newUser.name = "John Smith";

    // Create a post
    const newPost = uow.posts.create({
      title: "My First Post",
      content: "Hello, world!",
      authorId: newUser.id,
    });

    // Save all changes
    await uow.save();
    console.log("Changes saved!");

    // Find users efficiently with identity map caching
    const user = await uow.users.find({ id: newUser.id });
    console.log("Found user:", user);

    // Find multiple users
    const multipleUsers = await uow.users.find({ id: [1, 2, 3] });
    console.log("Found users:", multipleUsers);

    // Delete a post
    uow.posts.delete(newPost);

    // Rollback to checkpoint (undoes the delete)
    uow.rollback(checkpoint1);

    // Save up to checkpoint
    await uow.save(checkpoint1);

  } finally {
    await client.end();
  }
}

// Run the example
if (import.meta.main) {
  example().catch(console.error);
}