import { FieldSpec } from '../specs';
import { ObjectScope } from './object-scope';

export class ObjectStore implements ObjectScope {
  set<T>(spec: FieldSpec<any, T>, value: T): void {
    throw new Error('Method not implemented.');
  }
  get<T>(spec: FieldSpec<any, T>): T | undefined {
    throw new Error('Method not implemented.');
  }
  subscribe(spec: FieldSpec, callback: () => void): () => void {
    throw new Error('Method not implemented.');
  }

}
