import { z } from "zod";

export const postgresPositiveInteger = z
  .number()
  .int()
  .positive()
  .max(2_147_483_647);

export const uuidSchema = z.uuid();

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);
