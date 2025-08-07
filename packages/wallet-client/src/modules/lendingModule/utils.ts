import BigNumber from 'bignumber.js'

export const Rate_Decimals = 27

export function fromRate(rate: bigint | number | string | BigNumber, decimal = 2) {
  if (!rate) return '0.00'
  return new BigNumber(rate.toString())
    .shiftedBy(-1 * Rate_Decimals)
    .multipliedBy(100)
    .decimalPlaces(decimal, BigNumber.ROUND_DOWN)
    .toFixed(decimal)
}
