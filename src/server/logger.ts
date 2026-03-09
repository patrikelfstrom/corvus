import pino from 'pino';
import pretty from 'pino-pretty';
import { env } from './env.ts';

type PrettyLog = {
  [key: string]: unknown;
  err?: {
    message?: string;
    stack?: string;
    type?: string;
  };
  level?: string;
  msg?: string;
  time?: string;
};

const HIDDEN_KEYS = new Set(['err', 'hostname', 'level', 'msg', 'pid', 'time']);

export function formatPrettyMessage(log: PrettyLog): string {
  const line = [
    String(log.time ?? '')
      .replace('T', ' ')
      .replace('Z', ''),
    String(log.level ?? '').toUpperCase(),
    String(log.msg ?? ''),
    Object.entries(log)
      .filter(([key]) => !HIDDEN_KEYS.has(key))
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(' '),
  ]
    .filter(Boolean)
    .join(' ');

  if (!log.err) {
    return line;
  }

  const error =
    log.err.stack ?? `${log.err.type ?? 'Error'}: ${log.err.message ?? ''}`;
  return `${line}\n${error}`;
}

export const prettyOptions = {
  hideObject: true,
  ignore: 'pid,hostname,level,time',
  messageFormat: (log: PrettyLog) => formatPrettyMessage(log),
} as const;

export const logger = pino(
  {
    level: env.LOG_LEVEL,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  },
  pino.multistream([
    {
      stream: pretty({
        ...prettyOptions,
        destination: env.LOG_FILE_PATH,
        mkdir: true,
      }),
    },
    {
      stream: pretty({
        ...prettyOptions,
        destination: 1,
      }),
    },
  ]),
);
