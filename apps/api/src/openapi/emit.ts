import { buildOpenApi } from './document.js';
process.stdout.write(
  JSON.stringify(buildOpenApi(process.env.PUBLIC_API_URL ?? 'http://localhost:4000'), null, 2),
);
