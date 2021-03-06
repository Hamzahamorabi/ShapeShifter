import { Matrix } from 'app/scripts/common';
import { Path } from 'app/scripts/model/paths';
import * as _ from 'lodash';

import {
  ClipPathLayer,
  GroupLayer,
  Layer,
  PathLayer,
  VectorLayer,
} from '.';

const PRECISION = 8;

/**
 * Returns a list of parent transforms for the specified layer ID. The transforms
 * are returned in top-down order (i.e. the transform for the layer's
 * immediate parent will be the very last matrix in the returned list).
 */
function getTransformsForLayer(root: Layer, layerId: string) {
  const getTransformsFn = (parents: Layer[], current: Layer): Matrix[] => {
    if (current.id === layerId) {
      return _.flatMap(parents, layer => {
        if (layer instanceof GroupLayer) {
          const l = layer as GroupLayer;
          return [
            Matrix.fromTranslation(l.pivotX, l.pivotY),
            Matrix.fromTranslation(l.translateX, l.translateY),
            Matrix.fromRotation(l.rotation),
            Matrix.fromScaling(l.scaleX, l.scaleY),
            Matrix.fromTranslation(-l.pivotX, -l.pivotY),
          ];
        }
        return [];
      });
    }
    for (const child of current.children) {
      const transforms = getTransformsFn(parents.concat([current]), child);
      if (transforms) {
        return transforms;
      }
    }
    return undefined;
  };
  return getTransformsFn([], root);
}

/**
 * Returns a single flattened transform matrix that can be used to perform canvas
 * transform operations.
 */
export function getFlattenedTransformForLayer(root: Layer, layerId: string) {
  return Matrix.flatten(...getTransformsForLayer(root, layerId).reverse());
}

/**
 * Makes two vector layers with possibly different viewports compatible with each other.
 */
export function adjustViewports(vl1: VectorLayer, vl2: VectorLayer) {
  if (!vl1 || !vl2) {
    return { vl1, vl2 };
  }

  vl1 = vl1.deepClone();
  vl2 = vl2.deepClone();

  let { width: w1, height: h1 } = vl1;
  let { width: w2, height: h2 } = vl2;
  const isMaxDimenFn = (n: number) => {
    return Math.max(w1, h1, w2, h2, n) === n;
  };

  let scale1 = 1, scale2 = 1;
  if (isMaxDimenFn(w1)) {
    scale2 = w1 / w2;
  } else if (isMaxDimenFn(h1)) {
    scale2 = h1 / h2;
  } else if (isMaxDimenFn(w2)) {
    scale1 = w2 / w1;
  } else {
    scale1 = h2 / h1;
  }

  if (isMaxDimenFn(w1) || isMaxDimenFn(h1)) {
    w1 = _.round(w1, PRECISION);
    h1 = _.round(h1, PRECISION);
    w2 = _.round(w2 * scale2, PRECISION);
    h2 = _.round(h2 * scale2, PRECISION);
  } else {
    w1 = _.round(w1 * scale1, PRECISION);
    h1 = _.round(h1 * scale1, PRECISION);
    w2 = _.round(w2, PRECISION);
    h2 = _.round(h2, PRECISION);
  }

  let tx1 = 0, ty1 = 0, tx2 = 0, ty2 = 0;
  if (w1 > w2) {
    tx2 = (w1 - w2) / 2;
  } else if (w1 < w2) {
    tx1 = (w2 - w1) / 2;
  } else if (h1 > h2) {
    ty2 = (h1 - h2) / 2;
  } else if (h1 < h2) {
    ty1 = (h2 - h1) / 2;
  }

  const transformLayerFn =
    (vl: VectorLayer, scale: number, tx: number, ty: number) => {
      const transforms = [
        Matrix.fromScaling(scale, scale),
        Matrix.fromTranslation(tx, ty),
      ];
      (function recurseFn(layer: Layer) {
        if (layer instanceof PathLayer || layer instanceof ClipPathLayer) {
          if (layer instanceof PathLayer && layer.isStroked()) {
            layer.strokeWidth *= scale;
          }
          if (layer.pathData) {
            layer.pathData = new Path(layer.pathData.getCommands().map(cmd => {
              return cmd.mutate().transform(transforms).build();
            }));
          }
          return;
        }
        if (layer instanceof GroupLayer) {
          const l = layer as GroupLayer;
          l.translateX *= scale;
          l.translateY *= scale;
          l.pivotX *= scale;
          l.pivotY *= scale;
        }
        layer.children.forEach(l => recurseFn(l));
      })(vl);
    };

  transformLayerFn(vl1, scale1, tx1, ty1);
  transformLayerFn(vl2, scale2, tx2, ty2);

  const newWidth = Math.max(w1, w2);
  const newHeight = Math.max(h1, h2);
  vl1.width = newWidth;
  vl2.width = newWidth;
  vl1.height = newHeight;
  vl2.height = newHeight;
  return { vl1, vl2 };
}

export function mergeVectorLayers(vl1: VectorLayer, vl2: VectorLayer) {
  const { vl1: newVl1, vl2: newVl2 } = adjustViewports(vl1, vl2);
  const vl: VectorLayer =
    setLayerChildren(newVl1, newVl1.children.concat(newVl2.children));
  if (!newVl1.children.length) {
    // Only replace the vector layer's alpha if there are no children
    // being displayed to the user. This is pretty much the best
    // we can do.
    vl.alpha = newVl2.alpha;
  }
  return vl;
}

export function addLayerToTree(
  root: VectorLayer,
  addedLayerParentId: string,
  addedLayer: Layer,
  childIndex: number,
) {
  return (function recurseFn(curr: Layer) {
    if (curr.id === addedLayerParentId) {
      // If we have reached the added layer's parent, then
      // clone the parent, insert the new layer into its list
      // of children, and return the new parent node.
      const children = curr.children.slice();
      children.splice(childIndex, 0, addedLayer);
      return setLayerChildren(curr, children);
    }
    for (let i = 0; i < curr.children.length; i++) {
      const clonedChild = recurseFn(curr.children[i]);
      if (clonedChild) {
        // Then clone the current layer, insert the cloned child
        // into its list of children, and return the cloned current layer.
        const children = curr.children.slice();
        children[i] = clonedChild;
        return setLayerChildren(curr, children);
      }
    }
    return undefined;
  })(root) as VectorLayer;
}

export function removeLayersFromTree(vl: VectorLayer, ...removedLayerIds: string[]) {
  const layerIds = new Set(removedLayerIds);
  return (function recurseFn(curr: Layer) {
    if (layerIds.has(curr.id)) {
      return undefined;
    }
    const children = curr.children.map(l => recurseFn(l)).filter(l => !!l);
    return setLayerChildren(curr, children);
  })(vl) as VectorLayer;
}

export function replaceLayerInTree(
  root: VectorLayer,
  replacement: Layer,
) {
  return (function recurseFn(curr: Layer) {
    if (curr.id === replacement.id) {
      return replacement;
    }
    return setLayerChildren(curr, curr.children.map(child => recurseFn(child)));
  })(root) as VectorLayer;
}

export function findLayerByName(vls: ReadonlyArray<VectorLayer>, layerName: string) {
  for (const vl of vls) {
    const layer = vl.findLayerByName(layerName);
    if (layer) {
      return layer;
    }
  }
  return undefined;
}

export function findParent(vl: VectorLayer, layerId: string) {
  return (function recurseFn(curr: Layer, parent?: Layer): Layer {
    if (curr.id === layerId) {
      return parent;
    }
    for (const child of curr.children) {
      const p = recurseFn(child, curr);
      if (p) {
        return p;
      }
    }
    return undefined;
  })(vl);
}

export function findNextSibling(vl: VectorLayer, layerId: string) {
  return findSibling(layerId, findParent(vl, layerId), 1);
}

export function findPreviousSibling(vl: VectorLayer, layerId: string) {
  return findSibling(layerId, findParent(vl, layerId), -1);
}

function findSibling(layerId: string, parent: Layer, offset: number) {
  if (!parent || !parent.children) {
    return undefined;
  }
  let index = _.findIndex(parent.children, c => c.id === layerId);
  if (index < 0) {
    return undefined;
  }
  index += offset;
  if (index < 0 || parent.children.length <= index) {
    return undefined;
  }
  return parent.children[index];
}

export function getUniqueLayerName(
  layers: ReadonlyArray<Layer>,
  prefix: string,
) {
  return getUniqueName(
    prefix,
    name => findLayerByName(layers, name),
  );
}

export function getUniqueName(
  prefix = '',
  objectByNameFn = (s: string) => undefined,
) {
  let n = 0;
  const nameFn = () => prefix + (n ? `_${n}` : '');
  while (true) {
    const o = objectByNameFn(nameFn());
    if (!o) {
      break;
    }
    n++;
  }
  return nameFn();
}

function setLayerChildren(layer: Layer, children: ReadonlyArray<Layer>) {
  const clone = layer.clone();
  clone.children = children;
  return clone;
}
