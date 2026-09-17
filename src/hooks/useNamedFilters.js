import { useMemo } from 'react'
import { buildNamedFilters, filtersSignature, installNamedFilters } from '../lib/namedFilters'

/**
 * Every widget's named conditions, installed for the evaluators to read.
 *
 * Installed WHILE rendering rather than in an effect: the rows worked out
 * further down this same render -- calculated columns, filtered tabs --
 * already need it, and an effect would run only after they had been worked
 * out without it. Installing the same set twice changes nothing, so a
 * second render is harmless.
 *
 * KEPT while nothing in it changes. Saving any page delivers every page
 * again as brand-new objects, and a brand-new set of the same filters
 * would make every calculated column and every widget rule on the
 * dashboard be worked out again -- the better part of a second on a large
 * tab, for a save on some other page. So a new set is only adopted when
 * its signature differs.
 *
 * Returns the set, for the pickers to list and for a memo to depend on.
 */
export function useNamedFilters(pages) {
  const fresh = useMemo(() => buildNamedFilters(pages), [pages])
  const signature = useMemo(() => filtersSignature(fresh), [fresh])
  // Deliberately keyed on the signature alone: the set from the render
  // where the signature last changed is the one kept.
  const registry = useMemo(() => fresh, [signature])
  installNamedFilters(registry)
  return registry
}
