import type { Schemas } from "../core/api.js";

export type Fields = Record<string, any>;
export type DocId = Schemas["DocId"];
export type Filter = Schemas["Filter"];
export type Mode = Schemas["Mode"];
export type IndexSchema = Schemas["IndexSchema"];
export type IndexInfo = Schemas["IndexInfo"];
export type IndexSummary = Schemas["IndexSummary"];
export type Branch = Schemas["Branch"];
export type Version = Schemas["Version"];
export type Group = Schemas["Group"];
export type AttributeColumn = Schemas["AttributeColumn"];

export type Row<R extends Fields = Fields> = R & { id: DocId };
export type NewRow<R extends Fields = Fields> = R & { id?: DocId };
export type Hit<R extends Fields = Fields> = Row<R> & { score: number };

export type Target = DocId | DocId[] | { filter: Filter } | Filter;

export interface QueryOptions {
  text?: string;
  vector?: number[];
  filter?: Filter;
  limit?: number;
  mode?: Mode;
  sort?: Record<string, "asc" | "desc">;
  fields?: string[];
}

type Columns = string | string[];

export interface AggregateOptions {
  groupBy?: Columns;
  count?: boolean;
  sum?: Columns;
  avg?: Columns;
  min?: Columns;
  max?: Columns;
  filter?: Filter;
}

export interface IndexSettings {
  readOnly?: boolean;
  retentionDays?: number | null;
  pinned?: { replicas: number } | null;
  attributes?: AttributeColumn[];
  dropAttributes?: string[];
}

export interface NewIndexOptions {
  schema?: IndexSchema;
  region?: string;
  embed?: { model: string } | false;
}

export interface Upserted {
  ids: DocId[];
  count: number;
}
