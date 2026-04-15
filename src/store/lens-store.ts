import { LensImpl } from '../lens/index.js';
import { Lens } from '../lens/index.js';
import { ArraySpec, BaseSpec, ObjectSpec } from '../specs/index.js';
import { ObjectSpecChildren } from '../specs/object.js';

interface ArrayDescendant {
  arraySpec: BaseSpec;
  propKeys: string[];
}

export class LensStore {
  private lenses: WeakMap<BaseSpec, LensImpl<unknown, unknown>>;
  private arrayDescendants: WeakMap<BaseSpec, ArrayDescendant>;

  constructor(spec: ObjectSpec) {
    this.lenses = new WeakMap();
    this.arrayDescendants = new WeakMap();
    this.walkSpec(spec, Lens.identity());
  }

  private walkSpec(
    spec: BaseSpec,
    parentLens: LensImpl<unknown, unknown>,
  ): void {
    this.lenses.set(spec, parentLens);

    if (spec instanceof ObjectSpec) {
      for (const [key, child] of Object.entries(
        spec.children as ObjectSpecChildren,
      )) {
        this.walkSpec(child, parentLens.prop(key));
      }
    } else if (spec instanceof ArraySpec) {
      this.arrayDescendants.set(spec.item, { arraySpec: spec, propKeys: [] });
      for (const [key, child] of Object.entries(
        spec.item.children as ObjectSpecChildren,
      )) {
        this.walkArrayDescendant(child, spec, [key]);
      }
    }
  }

  private walkArrayDescendant(
    spec: BaseSpec,
    arraySpec: BaseSpec,
    propKeys: string[],
  ): void {
    this.arrayDescendants.set(spec, { arraySpec, propKeys: [...propKeys] });

    if (spec instanceof ObjectSpec) {
      for (const [key, child] of Object.entries(
        spec.children as ObjectSpecChildren,
      )) {
        this.walkArrayDescendant(child, arraySpec, [...propKeys, key]);
      }
    }
  }

  get(spec: BaseSpec): LensImpl<unknown, unknown> {
    const lens = this.lenses.get(spec);
    if (!lens) throw new Error(`Unknown spec: ${spec.id}`);
    return lens;
  }

  getWithIndex(
    spec: BaseSpec,
    index: number,
  ): LensImpl<unknown, unknown> {
    const info = this.arrayDescendants.get(spec);
    if (!info) throw new Error(`Spec is not an array item descendant: ${spec.id}`);

    const arrayLens = this.get(info.arraySpec);
    let lens: LensImpl<unknown, unknown> = arrayLens.index(index);
    for (const key of info.propKeys) {
      lens = lens.prop(key);
    }
    return lens;
  }
}
