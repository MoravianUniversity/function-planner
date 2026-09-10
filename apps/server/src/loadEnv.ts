import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });
