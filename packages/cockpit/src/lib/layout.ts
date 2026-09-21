import { useCallback, useState } from 'react';

/**
 * How the Files tab is arranged. 'rail' is the review path beside the diff;
 * 'column' is one reading column with the walk as a stepper on top and the
 * files behind a button.
 */
export type Layout = 'rail' | 'column';

/** Like the theme key, not scoped to a pull request: a layout is how a person reads. */
export const layoutKey = 'review-cockpit:layout';

export const LAYOUT_LABELS: Record<Layout, string> = {
  rail: 'Rail',
  column: 'Column',
};

export function readLayout(): Layout {
  try {
    return localStorage.getItem(layoutKey) === 'column' ? 'column' : 'rail';
  } catch {
    return 'rail';
  }
}

export function writeLayout(layout: Layout): void {
  try {
    if (layout === 'rail') localStorage.removeItem(layoutKey);
    else localStorage.setItem(layoutKey, layout);
  } catch {
    return;
  }
}

export function otherLayout(layout: Layout): Layout {
  return layout === 'rail' ? 'column' : 'rail';
}

export interface LayoutState {
  layout: Layout;
  toggle(): void;
}

export function useLayout(): LayoutState {
  const [layout, setLayout] = useState<Layout>(readLayout);
  const toggle = useCallback(() => {
    setLayout((current) => {
      const next = otherLayout(current);
      writeLayout(next);
      return next;
    });
  }, []);
  return { layout, toggle };
}
