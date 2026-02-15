"use client";

import { useEffect } from "react";

/**
 * Patches Node.removeChild and Node.insertBefore to silently handle
 * cases where browser translation extensions (Google Translate, etc.)
 * wrap text nodes in <font> tags, breaking React's DOM reconciliation.
 *
 * @see https://github.com/facebook/react/issues/11538
 */
export function TranslationSafeguard() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const originalRemoveChild = Node.prototype.removeChild;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Node.prototype as any).removeChild = function <T extends Node>(child: T): T {
      if (child.parentNode !== this) {
        console.warn(
          "[TranslationSafeguard] removeChild: node is not a child, likely modified by browser translation"
        );
        return child;
      }
      return originalRemoveChild.call(this, child) as T;
    };

    const originalInsertBefore = Node.prototype.insertBefore;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Node.prototype as any).insertBefore = function <T extends Node>(
      newNode: T,
      referenceNode: Node | null
    ): T {
      if (referenceNode && referenceNode.parentNode !== this) {
        console.warn(
          "[TranslationSafeguard] insertBefore: reference node is not a child, likely modified by browser translation"
        );
        return newNode;
      }
      return originalInsertBefore.call(this, newNode, referenceNode) as T;
    };

    return () => {
      Node.prototype.removeChild = originalRemoveChild;
      Node.prototype.insertBefore = originalInsertBefore;
    };
  }, []);

  return null;
}
