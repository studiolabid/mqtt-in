<script setup lang="ts">
/**
 * Values table under the chart: last / min / max / average and sample count per series over
 * the selected window. It is also the text equivalent of the chart (values never depend on
 * reading colors or hovering). Columns drop out by priority in narrow panels.
 *
 * Numbers use the chart's own formatter (`formatMeasure`, compact from a million), so the
 * legend and the table always print a value the same way (HEALTH-07). When the data covers less
 * than the window, `caption` says which span the statistics describe.
 */
import { formatMeasure } from '@/components/common/lib/chart/format'
import type { ChartRow } from '../composables/useTopicChart'

defineProps<{
  rows: readonly ChartRow[]
  /** Visible caption, e.g. 'Values of the last 4.8 s' (null: a caption for screen readers). */
  caption?: string | null
}>()

function value(v: number | null): string {
  return formatMeasure(v, { compact: true })
}
</script>

<template>
  <div class="@container/stats">
    <p
      v-if="caption"
      data-testid="chart-stats-caption"
      class="flex h-6 items-center text-xs text-muted-foreground"
    >
      {{ caption }}
    </p>
    <div class="overflow-hidden rounded-lg border">
      <table class="w-full table-fixed text-xs">
        <caption class="sr-only">
          {{
            caption ?? 'Statistics of the charted fields'
          }}
        </caption>
        <thead class="bg-muted/40 text-muted-foreground">
          <tr class="h-7 [&>th]:font-medium">
            <th scope="col" class="pl-3 text-left">Field</th>
            <th scope="col" class="w-[4.5rem] pr-3 text-right">Last</th>
            <th scope="col" class="hidden w-[4.5rem] pr-3 text-right @xs/stats:table-cell">Min</th>
            <th scope="col" class="hidden w-[4.5rem] pr-3 text-right @xs/stats:table-cell">Max</th>
            <th scope="col" class="hidden w-[4.5rem] pr-3 text-right @sm/stats:table-cell">Avg</th>
            <th
              scope="col"
              class="hidden w-16 pr-3 text-right @md/stats:table-cell"
              title="Values in the window"
            >
              Count
            </th>
          </tr>
        </thead>
        <tbody class="font-mono tabular-nums">
          <tr v-for="row in rows" :key="row.field" class="h-7 border-t">
            <th scope="row" class="pl-3 text-left font-normal">
              <span class="flex min-w-0 items-center gap-2">
                <span
                  class="h-0.5 w-3 shrink-0 rounded-full"
                  :style="{ backgroundColor: row.color }"
                  aria-hidden="true"
                />
                <span class="truncate text-muted-foreground" :title="row.field">{{
                  row.field
                }}</span>
              </span>
            </th>
            <td class="truncate pr-3 text-right font-medium text-foreground select-text">
              {{ value(row.stats.last) }}
            </td>
            <td
              class="hidden truncate pr-3 text-right text-foreground/80 select-text @xs/stats:table-cell"
            >
              {{ value(row.stats.min) }}
            </td>
            <td
              class="hidden truncate pr-3 text-right text-foreground/80 select-text @xs/stats:table-cell"
            >
              {{ value(row.stats.max) }}
            </td>
            <td
              class="hidden truncate pr-3 text-right text-foreground/80 select-text @sm/stats:table-cell"
            >
              {{ value(row.stats.avg) }}
            </td>
            <td class="hidden pr-3 text-right text-muted-foreground @md/stats:table-cell">
              {{ row.stats.count }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
