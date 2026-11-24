/**
 * Aggregator Configuration
 *
 * This module contains configuration constants for the DEX aggregator, including
 * API endpoints, contract addresses, and package IDs for various DEX protocols
 * supported on the Sui blockchain.
 *
 * @module AggregatorConfig
 */

/**
 * Configuration object containing all aggregator-related constants
 *
 * This object stores URLs, contract addresses, and package IDs for:
 * - Aggregator API endpoints
 * - Various DEX protocols (Cetus, Turbos, Kriya, etc.)
 * - System contracts and utilities
 */
export const AggregatorConfig = {
  // stSUI（AlphaFi 质押）：执行包 v2、LiquidStakingInfo<STSUI>
  alphafiPackageId: '0x059f94b85c07eb74d2847f8255d8cc0a67c9a8dcc039eabf9f8b9e23a0de2700',
  alphafiLiquidStakingInfo: '0x1adb343ab351458e151bc392fbf1558b3332467f23bda45ae67cd355a57fd5f5',
  stSuiCoinType: '0xd1b72982e40348d069bb1ff701e634c117bb5f741f44dff91e472d3b01461e55::stsui::STSUI',
  // haWAL（Haedal WAL 质押）：Haedal 包 v6、Walrus Staking、Haedal walstaking::Staking
  haWalPackageId: '0xd59779c4cbc3dc0bd53ce0a518116903623a6f2f30ee25bdfb5693691c82235d',
  walrusStaking: '0x10b9d30c28448939ce6c4d6c6e0ffce4a7f8a4ada8248bdad09ef8b70e4a3904',
  haWalStaking: '0x9e5f6537be1a5b658ec7eed23160df0b28c799563f6c41e9becc9ad633cb592b',
  // afSUI（Aftermath 质押）：LSD 包 v2 及其共享对象（注意 treasury / referral 是 LSD 的，不是 Aftermath AMM 的）
  afSuiPackageId: '0x1575034d2729907aefca1ac757d6ccfcd3fc7e9e77927523c06007d8353ad836',
  afSuiVault: '0x2f8f6d5da7f13ea37daa397724280483ed062769813b6f31e9788e59cc88994d',
  afSuiSafe: '0xeb685899830dd5837b47007809c76d91a098d52aabbf61e8ac467c59e5cc4610',
  afSuiReferralVault: '0x4ce9a19b594599536c53edb25d22532f82f18038dc8ef618afd00fbbfb9845ef',
  afSuiTreasury: '0xd2b95022244757b0ab9f74e2ee2fb2c3bf29dce5590fa6993a85d64bd219d7e8',
  afSuiValidator: '0xd30018ec3f5ff1a3c75656abf927a87d7f0529e6dc89c7ddd1bd27ecb05e3db2',
  // FlowX AMM（v2 恒定乘积）：包只有 v1；所有 pair 都在这个共享 Container 的 Bag 里
  flowxAmmPackageId: '0xba153169476e8c3114962261d1edc70de5ad9781b83cc617ecc8c1923191cae0',
  flowxAmmContainer: '0xb65dcbf63fd3ad5d0ebfbf334780dc9f785eff38a4459e37ab08fa79576ee511',
  // Aggregator API endpoint
  aggregatorBaseUrl: 'https://open-aggregator-api.naviprotocol.io/find_routes',

  // Main aggregator contract address
  aggregatorContract: '0xdd21f177ec772046619e401c7a44eb78c233c0d53b4b2213ad83122eef4147db',

  // coin utils contract address
  aggregatorUtilsContract: '0x044f4654db587bc811831778933f4a12215e74fd2af8cd99f22fdad30c7cf6e3',

  // Slippage config address
  slippageConfig: '0xd2aaed9e264080e9725992af038e882e28fe17fd9bc98a52a25e71206e5c16f5',

  // Cetus DEX configuration
  // Cetus integrate package v17 (links CLMM v15). It must track the CLMM GlobalConfig
  // package_version (currently 15): integrate v16 links CLMM v14 and aborts with code 10
  // in config::checked_package_version.
  cetusPackageId: '0x9ee0534b703b14457aee7698ea3a07a5080f954ed2b7e9910fbb7a55506824fa',
  cetusConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',

  // Turbos DEX configuration
  turbosPackageId: '0xa5a0c25c79e428eba04fb98b3fb2a34db45ab26d4c8faf0d7e39d66a63891e64',

  // Kriya DEX configuration (V2 and V3)
  // kriyaV3Version is the shared version registry object (unchanged across upgrades).
  // kriyaV3PackageId must track kriya's on-chain latest package; trade::flash_swap
  // version-gates via version::assert_supported_version (abort 69) when stale.
  // Bumped v2 (0xbd8d…) → v4 (0x0d7305a7…), the current on-chain version.
  kriyaV3Version: '0xf5145a7ac345ca8736cf8c76047d00d6d378f30e81be6f6eb557184d9de93c78',
  kriyaV3PackageId: '0x0d7305a7475ed54adc905365bd081939a81926636b4c438cf2f75f4924b8d960',
  kriyaV2PackageId: '0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66',

  // System clock address
  clockAddress: '0x6',

  // Aftermath DEX configuration
  // amm v5 package. swap::swap_exact_in keeps the v2 signature but runs pool_registry::assert_correct_package:
  // PoolRegistry.protocol_version must be <= 4 (abort 63) and not paused (abort 64). Since 2026-11-13 the registry is 4,
  // so the old v2 package (0xc4049b2d…, requires == 2) aborts with code 40 and v4 (0x3a6928bd…, accepts <= 3) with 63.
  aftermathPackageId: '0x93056cd889839d7186498c5e86d3087cb79dacb08ae0e18b9b2c42ebe06d7be7',
  aftermathPoolRegistry: '0xfcc774493db2c45c79f688f88d28023a3e7d98e4ee9f48bbf5c7990f651577ae',
  aftermathFeeVault: '0xf194d9b1bcad972e45a7dd67dd49b3ee1e3357a00a50850c52cd51bb450e13b4',
  aftermathTreasury: '0x28e499dff5e864a2eafe476269a4f5035f1c16f338da7be18b103499abf271ce',
  aftermathInsuranceFund: '0xf0c40d67b078000e18032334c3325c47b9ec9f3d9ae4128be820d54663d14e3b',
  aftermathReferralVault: '0x35d35b0e5b177593d8c3a801462485572fc30861e6ce96a55af6dc4730709278',

  // DeepBook DEX configuration
  deepbookPackageId: '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809',
  // DeepBook v3 execution package v9: DeepBook swaps call pool::swap_exact_* here directly.
  // Must stay in the pool's allowed_versions, otherwise load_inner aborts with code 11.
  deepbookLinkagePackageId: '0xbca0cefe720330e7bb4f2283438b68de6a0e656688db4ac90d61e71fe6151fe8',
  // No longer used since 2.0.9 (sponsored_deep is retired); kept so code reading these keys still compiles.
  deepSponsoredPackageId: '0x5871cfe2f6a5e432caea0a894aa51fc423fba798dfed540859abdf17ecc61219',
  deepSponsoredPoolConfig: '0x0b5e88bb54746b94bc5c7912f279cba30e0c4bd0241b935ba1d0d0c032218b6f',
  deepTokenAddress:
    '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',

  // Bluefin DEX configuration
  bluefinPackageId: '0xd075338d105482f1527cbfd363d6413558f184dec36d9138a70261e87f486e9c',
  bluefinGlobalConfig: '0x03db251ba509a8d5d8777b6338836082335d93eecbdd09a11e190a1cff51c352',

  // vSui DEX configuration
  vSuiPackageId: '0x68d22cf8bdbcd11ecba1e094922873e4080d4d11133e2443fddda0bfd11dae20',

  // haSui DEX configuration
  haSuiPackageId: '0x19e6ea7f5ced4f090e20da794cc80349a03e638940ddb95155a4e301f5f4967c',
  haSuiConfigId: '0x47b224762220393057ebf4f70501b6e657c3e56684737568439a04f80849b2ca',

  // Magma DEX configuration
  // Synced with @magmaprotocol/magma-ts-sdk@1.1.1 (released 2025-12-09).
  // The legacy integrate package 0x7c369062... routes into a deprecated
  // pool::split_fees that aborts in the b2a direction; magma published a
  // new integrate package on 2025-12-04 to bypass that path.
  magmaPackageId: '0x4a35d3dfef55ed3631b7158544c6322a23bc434fe4fca1234cb680ce0505f82d',
  magmaConfigId: '0x4c4e1402401f72c7d8533d0ed8d5f8949da363c7a3319ccef261ffe153d32f8a',
  magmaPublishedAt: '0x183af2adf115f331105825ae63e1d7d3c848d67beb4d60bc36208a90a5e92f4b',

  // Momentum DEX configuration
  momentumPackageId: '0xcf60a40f45d46fc1e828871a647c1e25a0915dec860d2662eb10fdb382c3c1d1',
  momentumVersionId: '0x2375a0b1ec12010aaea3b2545acfa2ad34cfbba03ce4b59f4c39e1e25eed1b2a',
  momentumSlippageCheckPackageId:
    '0x8add2f0f8bc9748687639d7eb59b2172ba09a0172d9e63c029e23a7dbdb6abe6',

  // FlowX DEX configuration
  flowxPackageId: '0xde2c47eb0da8c74e4d0f6a220c41619681221b9c2590518095f0f0c2d3f3c772',
  flowxPoolRegistry: '0x27565d24a4cd51127ac90e4074a841bbe356cca7bf5759ddc14a975be1632abc',
  flowxVersioned: '0x67624a1533b5aff5d0dfcf5e598684350efd38134d2d245f475524c03a64e656',

  // Magma ALMM DEX configuration
  // Synced with @magmaprotocol/magma-ts-sdk@1.1.1 almm_pool / almmConfig values.
  magmaAlmmPackageId: '0x532bf64e6f0bf702353387d53a28a3239249f47c39d58954f2c0a1f9f4436c20',
  magmaAlmmPublishedAt: '0x8800c3f7496a09dd62b0850b178b73ada2aeaf34d076dcd1c1bbd0da0015550d',
  // magmaIntegratePublishedAt is the package whose router::swap we call (see Dex/magma.ts).
  // It must track magma's on-chain GlobalConfig.package_version (currently 4). The value
  // from @magmaprotocol/magma-ts-sdk@1.1.1 (0x4a9d6fb6) is pre-v4 and aborts in
  // config::checked_package_version (code 10); 0x668909f9 is the current v4 integrate
  // package (verified by devInspect on both SUI->USDC and USDC->SUI).
  magmaIntegratePublishedAt: '0x668909f9f30380dd1b63834534dc2bd19b274e6312a0dfa9be0ee5b0cef73446',
  magmaAlmmFactory: '0xedb456e93e423dd75a8ddebedd9974bb661195043027e32ce01649d6ccee74cf',

  // Cetus DLMM configuration (protocol package, original 0x5664f9d3…).
  // cetusDlmmPublishedAt is the latest package (v10). It must track Versioned.version (currently 10):
  // versioned::check_version aborts in packages whose version constant is below it.
  cetusDlmmPublishedAt: '0x6b989f9b05bd11a00f1c7779443d66802c5e71631f59e87be5d2a616991f151e',
  cetusDlmmGlobalConfig: '0xf31b605d117f959b9730e8c07b08b856cb05143c5e81d5751c90d2979e82f599',
  cetusDlmmVersioned: '0x05370b2d656612dd5759cbe80463de301e3b94a921dfc72dd9daa2ecdeb2d0a8'
}

/**
 * Updates the aggregator configuration with new values
 *
 * This function allows runtime updates to the configuration object,
 * which can be useful for testing or dynamic configuration changes.
 *
 * @param newConfig - Partial configuration object with new values to merge
 */
export function updateConfig(newConfig: Partial<typeof AggregatorConfig>) {
  Object.assign(AggregatorConfig, newConfig)
}
