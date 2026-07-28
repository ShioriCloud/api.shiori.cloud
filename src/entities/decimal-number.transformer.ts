/** Convert Postgres numeric / decimal driver values to JS numbers. */
export const decimalNumberTransformer = {
  to: (value?: number | null) => value,
  from: (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined || value === '') return null
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : null
  },
}

export const decimalNumberRequiredTransformer = {
  to: (value: number) => value,
  from: (value: string | number | null | undefined): number => {
    if (value === null || value === undefined || value === '') return 0
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? n : 0
  },
}
