/**
 * Wall-clock budget for a performance assertion in a test. The budgets guard against superlinear
 * blowups, which take seconds on the inputs used, not against small slowdowns. Shared CI runners are
 * several times slower than a laptop and vary from run to run, so on CI the budget is four times larger:
 * still far below what a quadratic path would take.
 */
export const budget = (ms: number): number => (process.env.CI ? ms * 4 : ms);
