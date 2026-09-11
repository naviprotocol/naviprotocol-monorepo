import { FetchOptions, SimpleAdapter } from "../../adapters/types";
import { CHAIN } from "../../helpers/chains";
import { METRIC } from "../../helpers/metrics";
import fetchURL from "../../utils/fetchURL";
// Import paths are relative to the dimension-adapters repo root, which is where
// this file lives upstream. A copy is vendored in the NAVI monorepo outside that
// tree, so they are kept written the way upstream resolves them.
import { getEnv } from "../../helpers/env";

// ===========================================================================
// BLOCKED: this adapter cannot be merged yet.
// ---------------------------------------------------------------------------
// It reads a `vaults` section that does NOT exist on NAVI's DefiLlama fee
// endpoint today. The live endpoint (consumed by `fees/navi`) only covers the
// lending market: flashLoanRevenue, liquidationRevenue, borrowRevenue,
// borrowInterestRevenue, borrowInterestFee, naviDailyRevenue, naviDailyFee.
// Vault management/performance fees are not exposed anywhere public.
//
// NAVI must ship the `vaults` field described below before this adapter can be
// reviewed or merged; until then every call throws on the missing section,
// which is intentional (see the Data source rules in AGENTS.md: missing data
// must throw, never return 0).
// ===========================================================================

// The merged `fees/navi` adapter passes a `cf_pass` query parameter to this endpoint.
// NAVI's handler reads only `fromTimestamp` and never reads it; it is passed anyway so
// this request stays identical to the merged adapter's. Value: NAVI_DEFILLAMA_CF_PASS.
const NAVI_FEE_API = "https://open-api.naviprotocol.io/api/internal/defillama/fee";

// Vault group this listing covers. The on-chain objects behind it, for
// reference and so the adapter can be rebuilt if the endpoint disappears:
//   navi_vault package (call target)  0x13e1e0ddcf3a76cde006d530e98a0f985c446013cfedeae6dd067a2f1ea88ff5
//   original package (type prefix)    0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c
//   USDC Prime vault object            0x908c978d1a007aec4bcdc8233a0273de27ab059b9e6611bdad083457abb7f062
//   SUI Prime vault object             0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7
const VAULT_GROUP = "prime";

/** The `vaults.<group>` section NAVI must add to the endpoint. All values USD. */
interface VaultGroupStats {
  /** Gross yield earned by the group's vaults in the window, before any fee. */
  grossYieldUSD: number;
  /** Management fee accrued by the group's vaults in the window. */
  managementFeeUSD: number;
  /** Performance fee accrued by the group's vaults in the window. */
  performanceFeeUSD: number;
}

const methodology = {
  Fees: "Gross yield earned in the window by NAVI's Prime vaults on Sui, before any fee is taken. The yield comes from the NAVI lending markets the vaults supply into.",
  Revenue: "The management fee and performance fee NAVI charges on that yield. The published performance fee is 10% for the USDC vault and 5% for the SUI vault; both are read from NAVI's accounting rather than hardcoded here, so a rate change needs no adapter change.",
  ProtocolRevenue: "Management and performance fees retained by NAVI.",
  SupplySideRevenue: "The yield left for vault depositors after the management and performance fees.",
};

const fetch = async ({ startTimestamp, createBalances }: FetchOptions) => {
  const url = `${NAVI_FEE_API}?fromTimestamp=${startTimestamp}&cf_pass=${getEnv(
    "NAVI_DEFILLAMA_CF_PASS"
  )}`;
  const stats = (await fetchURL(url)).data;

  const group: VaultGroupStats | undefined = stats?.vaults?.[VAULT_GROUP];
  if (!group) {
    // Do not fall back to zero: a stored $0 would be cached by the refill job.
    throw new Error(
      `NAVI fee endpoint returned no vaults.${VAULT_GROUP} section - the vault fee fields are not live yet`
    );
  }
  for (const key of ["grossYieldUSD", "managementFeeUSD", "performanceFeeUSD"] as const) {
    if (typeof group[key] !== "number" || !isFinite(group[key]))
      throw new Error(`NAVI fee endpoint: vaults.${VAULT_GROUP}.${key} is missing or not a number`);
  }

  const dailyFees = createBalances();
  const dailyRevenue = createBalances();
  const dailySupplySideRevenue = createBalances();

  dailyFees.addUSDValue(group.grossYieldUSD, METRIC.ASSETS_YIELDS);

  dailyRevenue.addUSDValue(group.managementFeeUSD, METRIC.MANAGEMENT_FEES);
  dailyRevenue.addUSDValue(group.performanceFeeUSD, METRIC.PERFORMANCE_FEES);

  // dailyFees = dailyRevenue + dailySupplySideRevenue
  dailySupplySideRevenue.addUSDValue(
    group.grossYieldUSD - group.managementFeeUSD - group.performanceFeeUSD,
    METRIC.ASSETS_YIELDS
  );

  return {
    dailyFees,
    dailyRevenue,
    dailyProtocolRevenue: dailyRevenue,
    dailySupplySideRevenue,
  };
};

const adapter: SimpleAdapter = {
  version: 2,
  // The endpoint aggregates by whole UTC day keyed on `fromTimestamp`, so an
  // hourly pull would re-request the same daily bucket every hour.
  pullHourly: false,
  fetch,
  chains: [CHAIN.SUI],
  // navi_vault went live on Sui on 2026-08-17. Earlier dates have no vaults.
  start: "2026-08-17",
  methodology,
  breakdownMethodology: {
    Fees: {
      [METRIC.ASSETS_YIELDS]: "Gross yield earned by the Prime vaults from the NAVI lending markets they supply into",
    },
    Revenue: {
      [METRIC.MANAGEMENT_FEES]: "Management fee NAVI charges on assets held in the Prime vaults",
      [METRIC.PERFORMANCE_FEES]: "Performance fee NAVI charges on the yield the Prime vaults earn",
    },
    ProtocolRevenue: {
      [METRIC.MANAGEMENT_FEES]: "Management fee retained by NAVI",
      [METRIC.PERFORMANCE_FEES]: "Performance fee retained by NAVI",
    },
    SupplySideRevenue: {
      [METRIC.ASSETS_YIELDS]: "Yield paid out to Prime vault depositors after fees",
    },
  },
};

export default adapter;
