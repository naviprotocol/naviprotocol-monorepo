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
  // Aggregator API endpoint
  aggregatorBaseUrl: 'https://open-aggregator-api.naviprotocol.io/find_routes',

  // Main aggregator contract address
  aggregatorContract: '0xdd21f177ec772046619e401c7a44eb78c233c0d53b4b2213ad83122eef4147db',

  // Slippage config address
  slippageConfig: '0xd2aaed9e264080e9725992af038e882e28fe17fd9bc98a52a25e71206e5c16f5',

  // DCA contract (PROD - Updated 2025-11-26, minimum unit: MINUTE)
  dcaContract: '0x24ddd18c7a28abb5e6b539df230c0d639666f1b03ca468882cab7fa73ab3d6f0',
  dcaGlobalConfig: '0xaf8a8f682f7749c04da25c07cab110bd662d2c6d9289d291ec1833893891cf7c',
  dcaRegistry: '0x0c0ca114442c70d17c6bc18333d2e9c5c50a61d93e752c71a1780010c18cddb9',

  // Cetus DEX configuration
  cetusPackageId: '0xb2db7142fa83210a7d78d9c12ac49c043b3cbbd482224fea6e3da00aa5a5ae2d',
  cetusConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4438403a67a3d8f',

  // Turbos DEX configuration
  turbosPackageId: '0xd02012c71c1a6a221e540c36c37c81e0224907fe1ee05bfe250025654ff17103',

  // Kriya DEX configuration (V2 and V3)
  kriyaV3Version: '0xf5145a7ac345ca8736cf8c76047d00d6d378f30e81be6f6eb557184d9de93c78',
  kriyaV3PackageId: '0xbd8d4489782042c6fafad4de4bc6a5e0b84a43c6c00647ffd7062d1e2bb7549e',
  kriyaV2PackageId: '0xa0eba10b173538c8fecca1dff298e488402cc9ff374f8a12ca7758eebe830b66',

  // System clock address
  clockAddress: '0x6',

  // Aftermath DEX configuration
  aftermathPackageId: '0xc4049b2d1cc0f6e017fda8260e4377cecd236bd7f56a54fee120816e72e2e0dd',
  aftermathPoolRegistry: '0xfcc774493db2c45c79f688f88d28023a3e7d98e4ee9f48bbf5c7990f651577ae',
  aftermathFeeVault: '0xf194d9b1bcad972e45a7dd67dd49b3ee1e3357a00a50850c52cd51bb450e13b4',
  aftermathTreasury: '0x28e499dff5e864a2eafe476269a4f5035f1c16f338da7be18b103499abf271ce',
  aftermathInsuranceFund: '0xf0c40d67b078000e18032334c3325c47b9ec9f3d9ae4128be820d54663d14e3b',
  aftermathReferralVault: '0x35d35b0e5b177593d8c3a801462485572fc30861e6ce96a55af6dc4730709278',

  // DeepBook DEX configuration
  deepbookPackageId: '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809',
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
  magmaPackageId: '0x4a35d3dfef55ed3631b7158544c6322a23bc434fe4fca1234cb680ce0505f82d',
  magmaConfigId: '0x4c4e1402401f72c7d8533d0ed8d5f8949da363c7a3319ccef261ffe153d32f8a',
  magmaPublishedAt: '0x4a35d3dfef55ed3631b7158544c6322a23bc434fe4fca1234cb680ce0505f82d',

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
  magmaAlmmPackageId: '0x17ec44d20706af7f4ca563be7424bfa07c190f7f47bec157fa1eedaeec0bae3d',
  magmaAlmmPublishedAt: '0xa8b3dbe60b27160e2267c237759dd26f1dfe04e3f2d7cb0fc235a1497bdbfc09',
  magmaIntegratePublishedAt: '0x7c369062640451c79e4e8ef7540df7540d88a002d04c91ee37c771997739963f',
  magmaAlmmFactory: '0x29999aadee09eb031cc98a73b605805306d6ae0fe9d5099fb9e6628d99527234'
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
