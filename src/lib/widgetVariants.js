// ---------------------------------------------------------------------
// One name in the palette, several shapes behind it
// ---------------------------------------------------------------------
// "Chart" is one button and twenty-one drawings. A bar chart and a treemap
// are not variations on a theme -- they answer different questions -- and
// hiding both behind a word means the way anybody finds the treemap is by
// adding a chart, opening its editor, and reading a dropdown.
//
// So a type with shapes behind it OPENS instead of adding: the palette
// becomes those shapes, the other types step aside, and each one is drawn
// rather than named. It is the same move the page makes when a widget has
// widgets inside it (lib/widgetNest.js) -- go in, look, come back.
//
// A variant is a TYPE PLUS A PATCH. Nothing new is stored and no widget
// learns a second identity: picking "Donut" adds a chart whose `chartType`
// is donut, which is exactly what picking Chart and then changing the
// dropdown has always produced. So every editor, every saved page and every
// renderer already understands the result.

import { CHART_TYPES } from './config.js'

/**
 * The variants of one type.
 *
 * `preview` names a sketch (see components/WidgetTypePreview.jsx). It is
 * separate from `value` because several shapes honestly look the same at
 * thumbnail size -- a bar and a cylinder bar differ by a rounded top, which
 * is not a difference worth drawing twice.
 */
const chartVariant = (value, label, preview = value) => ({
  value,
  label,
  preview: `chart:${preview}`,
  patch: { chartType: value },
})

export const WIDGET_VARIANTS = {
  chart: {
    label: 'Charts',
    hint: 'Same data, different question. Every one of these can be changed later.',
    options: CHART_TYPES.map((t) =>
      chartVariant(
        t.value,
        t.label,
        // Shapes that are the same drawing at 140px share one.
        { cylinder: 'bar', arrow: 'bar', arrowRow: 'hbar', progress: 'hbar', step: 'line', rose: 'pie' }[t.value] ||
          t.value
      )
    ),
  },

  // One palette entry, three genuinely different pictures: a stack is a
  // total broken up, a 100% stack is a mix, and grouped bars are a
  // comparison. Reading the difference off the word "Stacked / Grouped" is
  // not something anybody does.
  stacked: {
    label: 'Bars',
    hint: 'How the second column is drawn against the first.',
    options: [
      {
        value: 'stacked',
        label: 'Stacked',
        preview: 'stacked:stacked',
        patch: { layout: 'stacked', percentStack: false },
      },
      {
        value: 'percent',
        label: 'Stacked to 100%',
        preview: 'stacked:percent',
        patch: { layout: 'stacked', percentStack: true },
      },
      {
        value: 'grouped',
        label: 'Grouped',
        preview: 'stacked:grouped',
        patch: { layout: 'grouped', percentStack: false },
      },
    ],
  },
}

/** The variants of a type, or none. */
export function variantsFor(type) {
  return WIDGET_VARIANTS[type]?.options || []
}

/** Whether picking this type should open rather than add. */
export function hasVariants(type) {
  return variantsFor(type).length > 1
}

/** One variant, by the type it belongs to and its own value. */
export function variantOf(type, value) {
  return variantsFor(type).find((v) => v.value === value) || null
}

/**
 * A new widget's extra fields, given the variant chosen.
 *
 * An unknown variant patches nothing rather than guessing: a type that has
 * lost a shape since a page was written should add its default, not its
 * first.
 */
export function variantPatch(type, value) {
  return variantOf(type, value)?.patch || {}
}

/** What the palette says while it is showing one type's shapes. */
export function variantTitle(type) {
  return WIDGET_VARIANTS[type]?.label || ''
}

export function variantHint(type) {
  return WIDGET_VARIANTS[type]?.hint || ''
}
