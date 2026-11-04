import type { z } from 'zod';

/** Parses untrusted input; throws ZodError which ProblemFilter turns into a 400. */
export const parse = <T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> => schema.parse(input);
