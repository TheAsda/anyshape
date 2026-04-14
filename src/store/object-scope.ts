import { BaseSpec, FieldSpec } from '../specs';

export interface ObjectScope {
  set<T>(spec: FieldSpec<any, T>, value: T): void;
  get<T>(spec: FieldSpec<any, T>): T | undefined;
  subscribe(spec: FieldSpec, callback: () => void): () => void;
}
