import { useMemo } from 'react'
import { buildNamedFilters, installNamedFilters } from '../lib/namedFilters'

/**
 * Every widget's named conditions, installed for the evaluators to read.
 *
 * Installed WHILE rendering rather than in an effect: the rows worked out
 * further down this same render -- calculated columns, filtered tabs --
 * already need it, and an effect would run only after they had been worked
 * out without it. Installing the same set twice changes nothing, so a
 * second render is harmless.
 *
 * Returns the set, for the pickers to list and for a memo to depend on.
 */
export function useNamedFilters(pages) {
  const registry = useMemo(() => buildNamedFilters(pages), [pages])
  installNamedFilters(registry)
  return registry
}
