import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
    throw new Error('DATABASE_URL is required');

export const sql = neon(connectionString);
export type DbRecord = Record<string, unknown>;
