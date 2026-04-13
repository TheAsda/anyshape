import { Lens } from '../lens';
import { BaseSpec, ObjectSpec } from '../specs';
import { ObjectSpecChildren } from '../specs/object';

export class LensStore {
  private lenses: WeakMap<BaseSpec, Lens>;

  constructor(spec: ObjectSpec) {
    this.lenses = new WeakMap();
    this.walkSpec(spec, new Lens());
  }

  private walkSpec(spec: BaseSpec, parentLens: Lens) {
    this.lenses.set(spec, parentLens);
    switch (true) {
      case spec instanceof ObjectSpec:
        for (const [key, child] of Object.entries(
          spec.children as ObjectSpecChildren,
        )) {
          this.walkSpec(child, parentLens.prop(key));
        }
        break;
    }
  }

  get(spec: BaseSpec) {
    const lens = this.lenses.get(spec);
    if (!lens) throw new Error(`Unknown spec: ${spec.id}`);
    return lens;
  }
}
