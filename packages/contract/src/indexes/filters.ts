import { z } from "../schemas.ts";

export const Filter = z.record(z.string(), z.unknown()).openapi("Filter", {
  description:
    "Keyword objects: `{and: [..]}`, `{or: [..]}`, `{not: ..}`, or `{<attribute>: {<op>: " +
    "value}}` with op `eq`, `ne`, `in`, `not_in`, `lt`, `lte`, `gt` or `gte`; on a list, " +
    "`contains_all` and `contains_any`; on a string, `glob`, `iglob` (any case), `regex` and " +
    '`fuzzy` (`{"text": "..", "edits": 0 to 2, "ignoreCase": false}`, a whole value within ' +
    "that many edits, a swap of two letters counting as one). `exists: true` holds when a " +
    "document has the attribute and `exists: false` when it does not. " +
    "`{id: {..}}` filters by document id with `eq`, `ne`, `in`, `not_in`, or `lt`, `lte`, `gt` and `gte` in id order, which pages through every document. " +
    "Many keys in one object must all hold. A document without the attribute fails every " +
    "comparison. On a list, an op holds if it holds for any item. In `search`, a " +
    "`text` attribute takes `phrase` (these words, in order), `prefix` (the same, the " +
    "last word a prefix), `contains_all_tokens` (every word, anywhere) or " +
    "`contains_any_token` (at least one word), at the top or inside `and`. Words are " +
    "analyzed as the attribute is: lowercased, stemmed, without stopwords if it drops them. " +
    "A `filterable` text attribute also takes the ops of a string, on its whole value.",
  example: { and: [{ tag: { eq: "billing" } }, { price: { lt: 10 } }] },
});

export const Condition = Filter.openapi("Condition", {
  description:
    "A filter checked against each document as it was before the write; a missing one has " +
    'no attributes. A value may be `{"$ref_new": "<attribute>"}`, that attribute of the ' +
    "document being written.",
  example: { version: { lt: { $ref_new: "version" } } },
});
