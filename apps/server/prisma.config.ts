import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts'
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Optional: required for `migrate diff --from-migrations` and for hosts that
    // cannot CREATE DATABASE. Locally, migrate dev can create a shadow DB when
    // the role has CREATEDB.
    ...(process.env.SHADOW_DATABASE_URL
      ? { shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL }
      : {})
  }
});
