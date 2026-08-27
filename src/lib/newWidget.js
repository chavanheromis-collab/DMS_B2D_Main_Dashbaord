import {
  AGGREGATIONS,
  DATALESS_WIDGETS,
  WIDGET_TYPES,
  KPI_PALETTE,
  NUMBER_FORMATS,
  PALETTE,
  SLIDER_FILTER_KINDS,
  STAGE_PALETTE,
  TABLE_CONTROL_KINDS,
  aggNeedsColumn,
  uid,
} from './config.js'

// One list of what a widget can be, not two. The types, their icons and
// their one-line descriptions have always lived in config; re-exporting is
// how this file offers them without becoming a second opinion about them.
export { WIDGET_TYPES }
import { looksLikeDateColumn } from './dataUtils.js'
import { DEFAULT_BLEND } from './blend.js'
import { DEFAULT_FLOW, DEFAULT_FLOW_LEVEL } from './flow.js'
// Every new widget type keeps its own defaults next to its own logic, and
// this file only assembles them. The alternative -- a second copy of each
// default here -- is how the two drift apart the first time one is tuned.
import { DEFAULT_STAT, DEFAULT_STAT_GRID } from './statGrid.js'
import { DEFAULT_BULLET, DEFAULT_BULLET_ROW } from './bullet.js'
import { DEFAULT_MOVERS } from './movers.js'
import { DEFAULT_WAFFLE } from './waffleData.js'
import { DEFAULT_CALENDAR } from './calendarHeat.js'
import { DEFAULT_GANTT } from './ganttData.js'
import { DEFAULT_COHORT } from './cohortData.js'
import { DEFAULT_BOXPLOT } from './boxplot.js'
import { DEFAULT_SANKEY } from './sankeyData.js'
import { DEFAULT_WORDCLOUD } from './wordCloud.js'
import { DEFAULT_PROFILE } from './columnProfile.js'
import { DEFAULT_COUNTDOWN } from './countdown.js'

// ---------------------------------------------------------------------
// A new widget, ready to look at
// ---------------------------------------------------------------------
// Adding a widget used to be a method inside the admin panel, which was
// fine while the admin panel was the only place a widget could be added.
// It is not any more -- a page in edit mode adds them itself -- and two
// copies of two hundred lines of defaults would be two dialects of what a
// new chart is within a month.
//
// Everything the defaults need arrives as an argument: the type, the tab it
// reads, the human name of that tab and its columns. No component, no
// context, no store -- so it can be called from anywhere and tested here.
//
// The defaults matter more than they look. A widget that renders as an
// empty box until somebody picks three more fields is a widget nobody
// finishes; every one of these is chosen so the thing DRAWS the moment it
// lands on the page.

/**
 * A new widget of `type`, pinned to `tab`.
 *
 * `name` is the tab's HUMAN label -- the default title has to read like a
 * title, and never like the internal ref the widget actually stores.
 */
export function makeWidget({ type = 'table', tab, name, cols = [], kpiCount = 0 } = {}) {
  // A note, an image and a countdown read no rows, so requiring a tab
  // before one can be added would mean a page with no spreadsheet
  // connected yet cannot even be given a heading. Everything else still
  // needs to know where its numbers come from.
  if (!tab && !DATALESS_WIDGETS.includes(type)) return null

  const base = {
    id: uid('w'),
    type: type,
    tab,
    blend: { ...DEFAULT_BLEND },
    title:
      type === 'table'
        ? name
        : type === 'kpi'
          ? `Total ${name}`
          : type === 'activity'
            ? `Recent ${name}`
            : type === 'scorecard'
              ? `${name} comparison`
              : `${name} breakdown`,
    width:
      type === 'kpi' || type === 'gauge'
        ? 'quarter'
        : type === 'leaderboard' || type === 'trend' || type === 'scorecard' || type === 'activity'
          ? 'twothird'
          : 'full',
    ignoreFilters: false,
  }

  if (type === 'kpi') {
    Object.assign(base, {
      aggregation: 'count',
      column: null,
      secondaryTab: '',
      secondaryAggregation: 'count',
      secondaryColumn: null,
      color: PALETTE[kpiCount % PALETTE.length],
      format: 'comma',
      icon: '',
    })
  } else if (type === 'table') {
    Object.assign(base, {
      columns: cols,
      pageSize: 25,
      editable: false,
      rowDetail: true,
      detailColumns: cols,
      detailTitleColumn: cols[0] || '',
      badgeColumns: [],
      downloadButtons: false,
      downloadColumns: [],
      sortBy: '',
      sortDir: 'asc',
    })
  } else if (type === 'pipeline') {
    Object.assign(base, {
      title: 'Workflow Pipeline',
      percentBase: 'first',
      showSparkline: true,
      stages: [
        {
          id: uid('s'),
          label: 'Stage 1',
          icon: '',
          color: STAGE_PALETTE[0],
          tab,
          match: 'all',
          conditions: [{ tab, column: '', operator: 'is_not_empty', value: '', value2: '' }],
          dateColumn: '',
          kpis: [
            {
              id: uid('sk'),
              label: 'Rows in stage',
              icon: '',
              color: KPI_PALETTE[0],
              aggregation: 'count',
              column: null,
              format: 'comma',
              match: 'all',
              conditions: [],
            },
          ],
          pivot: {
            rowColumn: '',
            colColumn: '',
            column: null,
            aggregation: 'count',
            format: 'comma',
            display: 'matrix',
          },
          leaderboard: {
            groupBy: '',
            limit: 10,
            color: '#4F46E5',
            sortBy: null,
            metrics: [
              {
                id: uid('sm'),
                label: 'Count',
                aggregation: 'count',
                column: null,
                format: 'comma',
              },
            ],
          },
        },
      ],
    })
  } else if (type === 'filters') {
    Object.assign(base, {
      title: 'Filters',
      width: 'quarter',
      controlIds: [],
      buttonColumns: 2,
      showSelectAll: true,
    })
  } else if (type === 'flow') {
    // Ships with one working level rather than an empty shell: a flow with
    // no levels is just a number, and the first thing anyone wants to see
    // is that clicking it opens something.
    Object.assign(base, {
      title: `${name} flow`,
      flow: {
        ...DEFAULT_FLOW,
        label: name,
        levels: [
          {
            ...DEFAULT_FLOW_LEVEL,
            id: uid('fl'),
            kind: 'split',
            column: cols[0] || '',
          },
        ],
      },
    })
  } else if (type === 'leaderboard') {
    Object.assign(base, {
      title: 'Leaderboard',
      groupBy: cols[0] || '',
      limit: 10,
      color: PALETTE[0],
      metrics: [{ id: uid('m'), label: 'Count', aggregation: 'count', column: null, format: 'comma' }],
      sortBy: '',
    })
  } else if (type === 'trend') {
    const dateCol = cols.find(looksLikeDateColumn) || ''
    Object.assign(base, {
      title: `${name} over time`,
      dateColumn: dateCol,
      grain: 'month',
      aggregation: 'count',
      column: null,
      chartType: 'area',
      color: PALETTE[0],
      format: 'comma',
      height: 240,
    })
  } else if (type === 'pivot') {
    Object.assign(base, {
      title: `${name} pivot`,
      rowColumn: cols[0] || '',
      colColumn: cols[1] || '',
      aggregation: 'count',
      column: null,
      color: PALETTE[0],
      format: 'comma',
    })
  } else if (type === 'gauge') {
    Object.assign(base, {
      title: `${name} target`,
      aggregation: 'count',
      column: null,
      target: 100,
      color: PALETTE[0],
      format: 'comma',
      icon: '',
      lowerIsBetter: false,
      conditions: [],
      conditionsMatch: 'all',
    })
  } else if (type === 'heatmap') {
    Object.assign(base, {
      title: `${name} heat map`,
      rowColumn: cols[0] || '',
      colColumn: cols[1] || '',
      aggregation: 'count',
      column: null,
      scale: 'indigo',
      format: 'comma',
      maxRows: 15,
      maxCols: 12,
    })
  } else if (type === 'stacked') {
    Object.assign(base, {
      title: `${name} breakdown`,
      groupBy: cols[0] || '',
      stackBy: cols[1] || '',
      aggregation: 'count',
      column: null,
      layout: 'stacked',
      limit: 12,
      maxSeries: 8,
      sort: 'value_desc',
      format: 'comma',
      height: 280,
      showLegend: true,
    })
  } else if (type === 'combo') {
    Object.assign(base, {
      title: `${name} combo`,
      groupBy: cols[0] || '',
      aggregation: 'count',
      column: null,
      barLabel: 'Count',
      format: 'comma',
      color: PALETTE[0],
      lineAggregation: 'avg',
      lineColumn: null,
      lineLabel: 'Average',
      lineFormat: 'comma',
      lineColor: PALETTE[4],
      limit: 12,
      sort: 'value_desc',
      height: 280,
      showLegend: true,
    })
  } else if (type === 'scatter') {
    Object.assign(base, {
      title: `${name} scatter`,
      xColumn: '',
      yColumn: '',
      sizeColumn: '',
      groupBy: '',
      limit: 400,
      format: 'comma',
      height: 280,
      showLegend: true,
    })
  } else if (type === 'activity') {
    const dateCol = cols.find(looksLikeDateColumn) || ''
    Object.assign(base, {
      dateColumn: dateCol,
      titleColumn: cols[0] || '',
      subtitleColumns: cols.slice(1, 3),
      limit: 15,
      color: PALETTE[0],
      ignoreFilters: true, // "respect page filters" defaults OFF -- see editor
    })
  } else if (type === 'scorecard') {
    Object.assign(base, {
      aggregation: 'count',
      column: null,
      format: 'comma',
      lowerIsBetter: false,
      labelA: 'A',
      labelB: 'B',
      colorA: PALETTE[0],
      colorB: '#94A3B8',
      matchA: 'all',
      matchB: 'all',
      conditionsA: [],
      conditionsB: [],
    })
  } else if (type === 'stat') {
    // Three stats rather than an empty grid: the whole point of this
    // widget is that the numbers sit together, and one number in a
    // three-column grid demonstrates nothing about what it is for.
    const dateCol = cols.find(looksLikeDateColumn) || ''
    Object.assign(base, {
      ...DEFAULT_STAT_GRID,
      title: `${name} at a glance`,
      width: 'full',
      dateColumn: dateCol,
      stats: [
        { ...DEFAULT_STAT, id: uid('st'), label: 'Total rows', color: PALETTE[0], compare: dateCol ? 'previous' : 'none' },
        {
          ...DEFAULT_STAT,
          id: uid('st'),
          label: cols[0] ? `${cols[0]} filled` : 'Filled',
          color: PALETTE[1],
          aggregation: 'count_filled',
          column: cols[0] || null,
        },
        {
          ...DEFAULT_STAT,
          id: uid('st'),
          label: cols[0] ? `Distinct ${cols[0]}` : 'Distinct',
          color: PALETTE[2],
          aggregation: 'count_distinct',
          column: cols[0] || null,
        },
      ],
    })
  } else if (type === 'bullet') {
    Object.assign(base, {
      ...DEFAULT_BULLET,
      title: `${name} against target`,
      width: 'half',
      rows: [
        {
          ...DEFAULT_BULLET_ROW,
          id: uid('bl'),
          label: name,
          color: PALETTE[0],
          target: 100,
        },
      ],
    })
  } else if (type === 'movers') {
    const dateCol = cols.find(looksLikeDateColumn) || ''
    Object.assign(base, {
      ...DEFAULT_MOVERS,
      title: `${name} — what changed`,
      width: 'twothird',
      groupBy: cols[0] || '',
      dateColumn: dateCol,
      // With no date column there is no "before", so the widget opens on
      // the mode that at least has two sides to compare.
      periodMode: dateCol ? 'date' : 'conditions',
    })
  } else if (type === 'waffle') {
    Object.assign(base, {
      ...DEFAULT_WAFFLE,
      title: `${name} share`,
      width: 'third',
      groupBy: cols[0] || '',
    })
  } else if (type === 'calendar') {
    Object.assign(base, {
      ...DEFAULT_CALENDAR,
      title: `${name} by day`,
      width: 'full',
      dateColumn: cols.find(looksLikeDateColumn) || '',
    })
  } else if (type === 'gantt') {
    // Two date columns if the tab has them, which is what makes this draw
    // something the moment it lands rather than after four more choices.
    const dates = cols.filter(looksLikeDateColumn)
    Object.assign(base, {
      ...DEFAULT_GANTT,
      title: `${name} timeline`,
      width: 'full',
      startColumn: dates[0] || '',
      endColumn: dates[1] || '',
      labelColumn: cols.find((c) => !looksLikeDateColumn(c)) || cols[0] || '',
    })
  } else if (type === 'cohort') {
    Object.assign(base, {
      ...DEFAULT_COHORT,
      title: `${name} retention`,
      width: 'full',
      dateColumn: cols.find(looksLikeDateColumn) || '',
      entityColumn: cols.find((c) => !looksLikeDateColumn(c)) || '',
    })
  } else if (type === 'boxplot') {
    Object.assign(base, {
      ...DEFAULT_BOXPLOT,
      title: `${name} spread`,
      width: 'half',
      column: cols[1] || cols[0] || '',
      groupBy: cols[0] || '',
      color: PALETTE[0],
    })
  } else if (type === 'sankey') {
    Object.assign(base, {
      ...DEFAULT_SANKEY,
      title: `${name} flow`,
      width: 'full',
      stages: [cols[0] || '', cols[1] || ''].filter(Boolean),
    })
  } else if (type === 'wordcloud') {
    Object.assign(base, {
      ...DEFAULT_WORDCLOUD,
      title: `${name} in their words`,
      width: 'half',
      column: cols[0] || '',
      color: PALETTE[0],
    })
  } else if (type === 'profile') {
    Object.assign(base, {
      ...DEFAULT_PROFILE,
      title: `${name} data check`,
      width: 'half',
      // Every column by default. A profiler that starts with nothing to
      // profile is a profiler nobody sees the point of.
      columns: [],
    })
  } else if (type === 'note') {
    Object.assign(base, {
      title: 'Section',
      noteStyle: 'section',
      width: 'full',
      text: '',
      align: 'left',
      icon: '',
      tone: 'info',
      color: PALETTE[0],
    })
  } else if (type === 'media') {
    Object.assign(base, {
      // Named rather than blank. A bare picture is a perfectly good
      // outcome and one field away -- but a widget with no title is a
      // blank row in the admin list, which is nobody's idea of a default.
      title: 'Image',
      width: 'third',
      imageUrl: '',
      caption: '',
      alt: '',
      fit: 'contain',
      bare: false,
      rounded: true,
    })
  } else if (type === 'countdown') {
    Object.assign(base, {
      ...DEFAULT_COUNTDOWN,
      title: 'Countdown',
      width: 'quarter',
      // Defaults to the end of the current month, which is what almost
      // every countdown on a sales dashboard is actually counting to.
      target: endOfThisMonth(),
      label: 'Left this month',
    })
  } else {
    Object.assign(base, {
      chartType: 'bar',
      groupBy: cols[0] || '',
      column: null,
      aggregation: 'count',
      limit: 12,
      sort: 'value_desc',
      color: PALETTE[0],
      format: 'comma',
      height: 260,
    })
  }

  return base
}

/** `2026-08-31`, for a countdown that means something the moment it lands. */
function endOfThisMonth() {
  const now = new Date()
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`
}
