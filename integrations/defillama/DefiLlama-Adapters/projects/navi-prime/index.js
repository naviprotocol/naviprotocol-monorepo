const sui = require("../helper/chain/sui")

// NAVI Vault (`navi_vault`) — production deployment, "Prime" (blue-chip) vaults only.
//
// Deployment descriptor (NAVI's own source of truth):
//   packageId  (current call target)   0x13e1e0ddcf3a76cde006d530e98a0f985c446013cfedeae6dd067a2f1ea88ff5
//   originalPackageId (type prefix)    0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c
//   module                             navi_vault, struct Vault<CoinType>
//
// The vault object ids are hardcoded on purpose and must NOT be replaced by an
// enumeration over `Vault<CoinType>`: NAVI also runs a separate staging
// deployment of the same contract on mainnet (a different package id, but the
// same struct shape), and enumerating by type would pull those non-production
// vaults into TVL.
//
// The two "High Yield" vaults of the same deployment are a separate DefiLlama
// listing (`navi-high-yield`), matching how NAVI's own Earn page splits them.
const VAULTS = [
  {
    id: "0x908c978d1a007aec4bcdc8233a0273de27ab059b9e6611bdad083457abb7f062",
    name: "USDC Prime", // Vault<0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC>, 6 decimals
  },
  {
    id: "0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7",
    name: "SUI Prime", // Vault<0x2::sui::SUI>, 9 decimals
  },
]

// The coin type is normally read from the object's own generic type argument
// (`Vault<CoinType>`). These are the same values NAVI publishes in its
// deployment descriptor, kept only as a fallback in case the type string cannot
// be parsed.
const FALLBACK_COIN_TYPES = {
  "0x908c978d1a007aec4bcdc8233a0273de27ab059b9e6611bdad083457abb7f062":
    "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
  "0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7": "0x2::sui::SUI",
}

async function tvl(api) {
  const vaults = await sui.getObjects(VAULTS.map((v) => v.id))

  vaults.forEach((vault, i) => {
    const { id, name } = VAULTS[i]
    if (!vault) throw new Error(`NAVI Prime: vault object not found: ${name} (${id})`)

    // `Vault<CoinType>` -> `CoinType`
    const coinType = vault.type?.replace(">", "").split("<")[1] || FALLBACK_COIN_TYPES[id]
    if (!coinType) throw new Error(`NAVI Prime: could not resolve coin type for ${name} (${id})`)

    // `total_assets` (u64, base units) is the vault's whole book: its idle
    // balance plus everything it has supplied into NAVI's lending markets.
    // The vault has no borrow entrypoint, so there is nothing to net out.
    const totalAssets = vault.fields?.total_assets
    if (totalAssets === undefined) throw new Error(`NAVI Prime: total_assets missing on ${name} (${id})`)

    api.add(coinType, totalAssets)
  })
}

module.exports = {
  timetravel: false,
  // The vaults deposit their assets into NAVI's own lending markets, which are
  // already counted by the `navi` listing.
  doublecounted: true,
  methodology:
    "Sums the `total_assets` field of NAVI's two Prime (blue-chip) vault objects on Sui: USDC Prime and SUI Prime. `total_assets` is each vault's idle balance plus the assets it has supplied into NAVI's lending markets, read directly from the vault object. Nothing is borrowed by the vaults, so nothing is netted out. Marked as double counted because the supplied assets are already included in the NAVI lending market TVL.",
  sui: {
    tvl,
  },
}
