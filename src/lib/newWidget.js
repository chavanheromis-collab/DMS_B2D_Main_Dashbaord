import {
  AGGREGATIONS,
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
  if (!tab) return null

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
