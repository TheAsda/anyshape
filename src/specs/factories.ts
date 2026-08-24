import { ArraySpec, ArraySpecOptions } from './array.js';
import type { BaseSpec } from './base.js';
import { FieldSpec, FieldSpecOptions } from './field.js';
import { MetaSpec, MetaSpecOptions } from './meta.js';
import { ObjectSpec, ObjectSpecChildren, ObjectSpecOptions } from './object.js';

export function field<Valid, Raw = Valid | undefined>(
  config?: FieldSpecOptions<Valid, Raw>,
) {
  return new FieldSpec<Valid, Raw>(config);
}

export function object<Children extends ObjectSpecChildren>(
  children: Children,
  config?: ObjectSpecOptions<Children>,
) {
  return new ObjectSpec(children, config);
}

export function array<ItemSpec extends ObjectSpec>(
  itemSpec: ItemSpec,
  config?: ArraySpecOptions<ItemSpec>,
) {
  return new ArraySpec(itemSpec, config);
}

export function meta<Value>(config?: MetaSpecOptions) {
  return new MetaSpec<Value>(config);
}

export function form<Def extends ObjectSpecChildren>(definition: Def) {
  const spec = object(definition);
  assignPathIds(spec);
  return spec;
}

function assignPathIds(spec: ObjectSpec): void {
  function walk(node: BaseSpec, path: string): void {
    if (node.id.startsWith('spec_')) {
      (node as { id: string }).id = path;
    }

    if (node instanceof ObjectSpec) {
      for (const [key, child] of Object.entries(
        node.children as Record<string, BaseSpec>,
      )) {
        walk(child, `${path}.${key}`);
      }
    } else if (node instanceof ArraySpec) {
      walk(node.item, `${path}[]`);
    }
  }

  for (const [key, child] of Object.entries(spec.children)) {
    walk(child, key);
  }
}
