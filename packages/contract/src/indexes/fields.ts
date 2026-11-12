import { z } from "../schemas.ts";
import { DIMS_MAX, IMAGE_MAX, TEXT_MAX } from "./limits.ts";

export const COLUMN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export const ColumnName = z
  .string()
  .max(64)
  .regex(COLUMN, "use up to 64 letters, digits, `_` and `.`, each part not starting with a digit");

export const IndexVersionId = z.string().regex(/^[0-9a-f]{64}$/, "not an index version");

const Image = z
  .object({
    image: z
      .string()
      .min(1)
      .max(IMAGE_MAX)
      .regex(/^(?:https:\/\/|data:image\/)/, "an https URL or a data:image/ URL"),
  })
  .strict()
  .openapi("Image", {
    description:
      "An image for a column with `embed`, as an https URL or a base64 `data:image/...` " +
      "URL. Its model must take images.",
  });

export const VectorValue = z.union([
  z.array(z.number()).min(1).max(DIMS_MAX),
  z.string().min(1).max(TEXT_MAX),
  Image,
]);
export type VectorValue = z.output<typeof VectorValue>;
