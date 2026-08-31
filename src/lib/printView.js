// ---------------------------------------------------------------------
// A dashboard somebody can hand to a meeting
// ---------------------------------------------------------------------
// Every BI tool in the field has an export-to-PDF, and for one reason: the
// people who decide things are not the people looking at the screen. A
// dashboard that cannot leave the browser gets screenshotted into a slide,
// and a screenshot has no record of what it was showing.
//
// That last part is the whole problem. A printed chart of "Bookings by
// branch" reading 412 is not a fact -- it is a fact ABOUT a filter: this
// month, these three branches, financed only. Print it without the filters
// and it is a number somebody will quote back at you in six weeks, wrongly.
//
// So the print header is not decoration. It is the page's name, the moment
// it was taken, and every narrowing that was in force -- and it is built
// from the same control state the page itself reads, so it cannot describe
// a page other than the one on the paper.
//
// Pure: controls and values in, lines of text out. No React, no printing.

import { controlActive, controlMode, isButton } from './pageControls.js'

/**
 * What a value looks like written down.
 *
 * A multi-choice control holds an array, a range holds two ends, and a
 * button holds nothing at all -- it is on. Each has to read as a phrase
 * somebody can check against the sheet.
 */
export function valueText(value) {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.filter((v) => v !== '' && v != null).join(', ')

  if (typeof value === 'object') {
    // A range: `{ min, max }`, `{ from, to }`, or a slider's own shape. Only
    // the ends that were actually set are written -- "up to 500" is a real
    // filter and "0 to 500" would be a different, wronger claim.
    const from = value.min ?? value.from ?? value.start ?? ''
    const to = value.max ?? value.to ?? value.end ?? ''
    if (from !== '' && to !== '') return `${from} – ${to}`
    if (from !== '') return `from ${from}`
    if (to !== '') return `up to ${to}`

    const days = value.days ?? value.lastDays
    if (days) return `last ${days} days`
    return ''
  }

  return String(value)
}

/**
 * Every narrowing in force, as lines for the printed header.
 *
 * `controlActive` decides what counts as active, deliberately -- it is the
 * same function the control bar uses to light a control up, so a control
 * that looks applied on screen is one that appears on the paper.
 *
 * A FIXED control appears too, and says so. It is a rule of the page that
 * the reader never sees and cannot turn off, which makes it exactly the
 * thing a printout has to disclose.
 */
export function appliedFilters(controls, values, activeButtonIds = [], crossFilters = []) {
  const lines = []

  for (const control of controls || []) {
    if (!control || control.hidden) continue
    if (!controlActive(control, values, activeButtonIds)) continue

    const label = control.label || control.column || 'Filter'
    // Through `controlMode`, not a raw field: a page saved before the
    // modes existed says it a different way, and the printout must not
    // be the one place that misreads it.
    const fixed = controlMode(control) === 'fixed'

    if (isButton(control)) {
      lines.push({ label, value: 'on', fixed })
      continue
    }

    const text = valueText(values?.[control.id])
    if (!text) continue
    lines.push({ label, value: text, fixed })
  }

  // A drill is a filter the reader made by clicking, and it is the one most
  // likely to be forgotten: nothing in the bar shows it.
  for (const cf of crossFilters || []) {
    if (!cf) continue
    const text = cf.label || valueText(cf.value)
    if (!text) continue
    lines.push({ label: 'Drilled into', value: text, drilled: true })
  }

  return lines
}

/** A one-line summary, for where there is no room for a list. */
export function filterSummary(lines) {
  if (!lines || lines.length === 0) return 'No filters applied — the whole dataset'
  return lines.map((l) => `${l.label}: ${l.value}`).join(' · ')
}

/**
 * When this was taken.
 *
 * Down to the minute, and with the date spelled out. A printout of a live
 * dashboard is a photograph, and a photograph with no date on it is the
 * beginning of an argument.
 */
export function printStamp(date = new Date()) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date()
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
