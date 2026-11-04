import pino from 'pino';

/** Structured JSON logs. Credentials, cookies and message bodies are redacted (DPDP: PII minimisation). */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'wd-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.token',
      '*.body',
      '*.description',
      '*.internalOemRef',
      '*.internal_oem_ref',
    ],
    censor: '[redacted]',
  },
});
