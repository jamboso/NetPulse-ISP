import { Request, Response, NextFunction } from "express";
import { z } from "zod/v4";

/**
 * Returns an Express middleware that validates `req.body` against the given Zod schema.
 * On failure it responds immediately with 400 and a descriptive error message.
 * On success it replaces `req.body` with the parsed (and coerced) value and calls `next()`.
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = z.flattenError(result.error);
      res.status(400).json({
        error: "Validation failed",
        fields: errors.fieldErrors,
        ...(errors.formErrors.length ? { form: errors.formErrors } : {}),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}
