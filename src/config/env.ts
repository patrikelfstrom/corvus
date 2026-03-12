import { z } from 'zod';

const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
]);

const envSchema = z.object({
  CONFIG_PATH: z.string().trim().min(1).default('data'),
  DB_PATH: z.string().trim().min(1).default('data'),
  LOG_FILE_PATH: z.string().trim().min(1).default('data/app.log'),
  LOG_LEVEL: logLevelSchema.default('info'),
  CORVUS_TASK_TOKEN: z.string().trim().min(1).optional(),
  CORVUS_TASK_HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.string().trim().min(1).default('3000'),
});

export type Env = z.infer<typeof envSchema>;

export function readEnv(): Env {
  return envSchema.parse(process.env);
}

export const env = readEnv();
