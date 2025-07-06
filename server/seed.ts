import dotenv from 'dotenv';
dotenv.config(); // Load .env variables first

import bcrypt from 'bcrypt';
import { Client } from 'pg';

async function seed() {
  const username = 'admin';
  const password = 'AdminSecure@2025';

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Please check your .env file.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database successfully for seeding.');

    // Check if admin user already exists
    const checkUserQuery = {
      text: 'SELECT * FROM users WHERE username = $1',
      values: [username],
    };
    const { rows } = await client.query(checkUserQuery);

    if (rows.length > 0) {
      console.log('Admin user already exists. Skipping seeding.');
      return;
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert the admin user
    // Note: Ensure the 'users' table and its columns ('username', 'password') exist.
    // Drizzle schema defines it as:
    // export const users = pgTable("users", {
    //   id: serial("id").primaryKey(),
    //   username: text("username").notNull().unique(),
    //   password: text("password").notNull(),
    // });
    const insertUserQuery = {
      text: 'INSERT INTO users (username, password) VALUES ($1, $2)',
      values: [username, hashedPassword],
    };
    await client.query(insertUserQuery);

    console.log('Admin user seeded successfully.');

  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  } finally {
    await client.end();
    console.log('Database connection closed.');
  }
}

seed();
