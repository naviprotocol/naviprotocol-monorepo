import { FetchOptions, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import { getEnv } from "../../helpers/env";
import { METRIC } from "../../helpers/metrics";
import fetchURL from "../../utils/fetchURL";

// Same endpoint the merged `fees/navi` adapter reads, which aggregates by whole
// UTC day keyed on `fromTimestamp`.
//
// `cf_pass` is passed for parity with that merged adapter's request. NAVI's
// handler for this path reads only `fromTimestamp` and never reads the
// parameter, but whether a Cloudflare edge rule keys on it cannot be checked
// from any repository, so the parameter is kept and its value is read from the
// environment instead of being committed here.
const NAVI_FEE_API = "https://open-api.naviprotocol.io/api/internal/defillama/fee";

// The on-chain objects behind this listing, kept here so the adapter can be
// rebuilt if the endpoint disappears. Public vault list, which is also the
// maintained source for this set: https://open-api.naviprotocol.io/api/vaults
//   navi_vault package (call target)  0x13e1e0ddcf3a76cde006d530e98a0f985c446013cfedeae6dd067a2f1ea88ff5
//   original package (type prefix)    0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c
//   USDC Prime vault object           0x908c978d1a007aec4bcdc8233a0273de27ab059b9e6611bdad083457abb7f062
//   SUI Prime vault object            0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7
//   USDC High Yield vault object      0x54359eb5d0e4364bd26989899fdb472f5594d1885e1f0d816ef4a066cab2ae4c
//   SUI High Yield vault object       0x864527a8ed2435aed828b46c6d9d0244506b418761cca25b7dd47a83c7797a29
// "Prime" and "High Yield" are NAVI's off-chain product labels over one
// contract, so they are one listing here.

/** One `vaults.<group>` section of the endpoint's response. All values USD. */
interface VaultGroupStats {
  /** Yield the group's vaults earned in the window, gross of every fee. */
  grossYieldUSD: number;
  /** Management fee the group's vaults accrued in the window, charged on assets held. */
  managementFeeUSD: number;
  /** Performance fee the group's vaults accrued in the window, charged on the yield earned. */
  performanceFeeUSD: number;
}

const NUMERIC_FIELDS = ["grossYieldUSD", "managementFeeUSD", "performanceFeeUSD"] as const;

const methodology = {
  Fees: "Yield NAVI's vaults on Sui earned in the day, plus the management fee NAVI charged on the assets they hold. The yield comes from the NAVI lending markets the vaults supply into, so it is also inside the borrower interest reported by the `navi` listing - this listing is marked as double counted for that reason.",
  Revenue: "The management fee NAVI charges on assets held in the vaults and the performance fee it charges on the yield they earn. Both amounts come from NAVI's own accounting for the day; no rate is assumed here.",
  ProtocolRevenue: "The same management and performance fees, all of which NAVI retains.",
  SupplySideRevenue: "The yield left for vault depositors after the performance fee.",
};

const fetch = async ({ startTimestamp, createBalances }: FetchOptions) => {
  const url = `${NAVI_FEE_API}?fromTimestamp=${startTimestamp}&cf_pass=${getEnv(
    "NAVI_DEFILLAMA_CF_PASS"
  )}`;
  const stats = (await fetchURL(url)).data;

  const groups: Record<string, VaultGroupStats> | undefined = stats?.vaults;
  // Missing data throws rather than returning 0: the refill job stores whatever
  // the adapter returns, and a stored $0 is indistinguishable from a real
  // zero-fee day.
  if (!groups || typeof groups !== "object" || Object.keys(groups).length === 0)
    throw new Error(`NAVI fee endpoint (${NAVI_FEE_API}) returned no vaults section`);

  // Every group the endpoint reports is summed, so a vault group NAVI adds
  // later is counted without an adapter change. Today it reports `prime` and
  // `highYield`.
  let grossYieldUSD = 0;
  let managementFeeUSD = 0;
  let performanceFeeUSD = 0;

  for (const [group, values] of Object.entries(groups)) {
    for (const field of NUMERIC_FIELDS) {
      const value = values?.[field];
      if (typeof value !== "number" || !isFinite(value) || value < 0)
        throw new Error(
          `NAVI fee endpoint: vaults.${group}.${field} is missing, not a finite number, or negative`
        );
    }
    // A performance fee is a cut of the yield, so it cannot exceed it. This is
    // also what keeps dailySupplySideRevenue non-negative below, which is why
    // this adapter needs no allowNegativeValue.
    if (values.performanceFeeUSD > values.grossYieldUSD)
      throw new Error(
        `NAVI fee endpoint: vaults.${group}.performanceFeeUSD (${values.performanceFeeUSD}) exceeds grossYieldUSD (${values.grossYieldUSD})`
      );

    grossYieldUSD += values.grossYieldUSD;
    managementFeeUSD += values.managementFeeUSD;
    performanceFeeUSD += values.performanceFeeUSD;
  }

  // fees/AGENTS.md: a management fee is charged on assets, not carved out of
  // the interest, so fees = interest + management fee, revenue = management fee
  // + performance fee, supply side = interest - performance fee.
  const dailyFees = createBalances();
  dailyFees.addUSDValue(grossYieldUSD, METRIC.ASSETS_YIELDS);
  dailyFees.addUSDValue(managementFeeUSD, METRIC.MANAGEMENT_FEES);

  const dailyRevenue = createBalances();
  dailyRevenue.addUSDValue(managementFeeUSD, METRIC.MANAGEMENT_FEES);
  dailyRevenue.addUSDValue(performanceFeeUSD, METRIC.PERFORMANCE_FEES);

  const dailySupplySideRevenue = createBalances();
  dailySupplySideRevenue.addUSDValue(grossYieldUSD - performanceFeeUSD, METRIC.ASSETS_YIELDS);

  return {
    dailyFees,
    dailyRevenue,
    dailyProtocolRevenue: dailyRevenue.clone(),
    dailySupplySideRevenue,
  };
};

const adapter: SimpleAdapter = {
  // The endpoint only serves whole-UTC-day aggregates keyed on
  // `fromTimestamp`, so hourly windows are not available.
  version: 1,
  fetch,
  chains: [CHAIN.SUI],
  // `start` is omitted on purpose: the endpoint does not serve the vaults
  // section for any date yet, so no date can be named as the earliest one that
  // actually returns data. It gets added, with a refill, once NAVI has
  // backfilled - the vaults went live on Sui on 2026-08-17.
  methodology,
  breakdownMethodology: {
    Fees: {
      [METRIC.ASSETS_YIELDS]: "Yield the vaults earned from the NAVI lending markets they supply into",
      [METRIC.MANAGEMENT_FEES]: "Management fee NAVI charged on the assets held in the vaults",
    },
    Revenue: {
      [METRIC.MANAGEMENT_FEES]: "Management fee NAVI charged on the assets held in the vaults",
      [METRIC.PERFORMANCE_FEES]: "Performance fee NAVI charged on the yield the vaults earned",
    },
    ProtocolRevenue: {
      [METRIC.MANAGEMENT_FEES]: "Management fee retained by NAVI",
      [METRIC.PERFORMANCE_FEES]: "Performance fee retained by NAVI",
    },
    SupplySideRevenue: {
      [METRIC.ASSETS_YIELDS]: "Yield paid to vault depositors, after the performance fee",
    },
  },
  // The vaults earn by supplying into NAVI's own lending markets, and
  // `fees/navi` already books 100% of that borrower interest in its dailyFees
  // (the lenders' share as its supply side). Reporting the same yield here
  // would count that flow twice in chain and category totals. The flag is
  // adapter-wide, so it also keeps NAVI's genuinely new management and
  // performance fee revenue out of those totals; counting nothing twice was
  // preferred over reporting that slice twice.
  doublecounted: true,
};

export default adapter;
