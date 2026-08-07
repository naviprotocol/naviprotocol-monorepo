/**
 * Bundled Mainnet Configuration Snapshot
 *
 * Generated from chain on 2026-08-05 by `navi_vault_setup/dump_vaults.ts`. This is a
 * fallback so the SDK works without a configuration service; it is not authoritative.
 *
 * Only identifiers live here. Anything an admin or curator can change without a
 * redeploy — pause state, caps, fees, penalties, market membership, rule activity — is
 * deliberately absent and must be read from chain via `getVaultLayout`.
 *
 * `packageId` changes on every contract upgrade, so a stale snapshot silently runs
 * superseded code. Override it with {@link configureVaultSdk} rather than relying on an
 * SDK release to carry the new value.
 *
 * @module VaultSnapshot
 */

import type { VaultConfig } from './types'

/** Date the snapshot was dumped from chain, ISO 8601. */
export const SNAPSHOT_GENERATED_AT = '2026-08-05T06:45:58.096Z'

/** Mainnet configuration as of {@link SNAPSHOT_GENERATED_AT}. */
export const MAINNET_VAULT_CONFIG: VaultConfig = {
  package: {
    packageId: '0x13e1e0ddcf3a76cde006d530e98a0f985c446013cfedeae6dd067a2f1ea88ff5',
    typePackageId: '0x51cecaacaed0bd436f04ebbd8ba0ca1627c9c4d0e54ad28eff095ca78591518c',
    expectedVaultVersion: 2
  },
  sharedObjects: {
    clock: '0x6',
    priceOracle: '0x1568865ed9a0b5ec414220e8f79b3d04c77acc82358f6e5ae4635687392ffbef',
    incentiveV2: '0xf87a8acb8b81d14307894d12595541a73f19933f88e1326d5be349c7a6f7559c',
    suiSystemState: '0x5'
  },
  vaults: [
    {
      key: 'SUI',
      displayName: 'SUI High Yield',
      vault: '0x864527a8ed2435aed828b46c6d9d0244506b418761cca25b7dd47a83c7797a29',
      timelocks: '0x04523a8d1f1a3019f9b8f5e61984544d5dfc467ec0e91d64f228a17e30737264',
      coinType: '0x2::sui::SUI',
      decimals: 9,
      markets: [
        {
          name: 'main',
          pool: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
          storage: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
          incentiveV3: '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80',
          assetId: 0,
          isDefault: true
        },
        {
          name: 'suieco',
          pool: '0xc1dfd32ec30a1ba16e8c1d32a284718ac8f41765722f27fe7fb9d0b38a570ae0',
          storage: '0xdf18372bc9c588b96c7553bc811467a9166ed9be472b40cb45c226175377c558',
          incentiveV3: '0x5ddc7f50eff9396f3f401a6194dda7b64c2ffc64fd581d119c44ae0587119309',
          assetId: 0,
          isDefault: false
        },
        {
          name: 'vsui-sui',
          pool: '0x3f2d878005dd9d5caf56467bc0c55f93bb5a3c83a5c7fb057032a0abf1bad4bf',
          storage: '0xafb982de1a436b1cc8a14ecd2d787762599b65d3a6b75b84b10939b1e17d9381',
          incentiveV3: '0x5a1d3333b37d206033bb49859d306e546cc8d9b81a0c854d899752227a91a2de',
          assetId: 1,
          isDefault: false
        }
      ],
      rewardRules: [
        {
          index: 0,
          naviPoolId: '0x96df0fce3c471489f4debaaa762cf960b3d97820bd1f3f025ff8190730e958c5',
          incentiveRuleId: '0xd483f186fa678d5f93912f5960f97f29796c12902245b79b9b7a87a4ca407e5a',
          rewardCoinType:
            '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
          isVaultNative: false,
          isActive: true,
          mustCollectBeforeWithdraw: true,
          rewardFund: '0x7093cf7549d5e5b35bfde2177223d1050f71655c7f676a5e610ee70eb4d93b5c',
          storage: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
          incentiveV3: '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
        }
      ]
    },
    {
      key: 'USDC',
      displayName: 'USDC High Yield',
      vault: '0x54359eb5d0e4364bd26989899fdb472f5594d1885e1f0d816ef4a066cab2ae4c',
      timelocks: '0x80696a1a627f9e02059c9dfed0e94ef7905424bc602ff85d3ad9fc47638887a6',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      decimals: 6,
      markets: [
        {
          name: 'main',
          pool: '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8',
          storage: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
          incentiveV3: '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80',
          assetId: 10,
          isDefault: true
        },
        {
          name: 'suieco',
          pool: '0x085b81d73c936f453a407b0ca5aaebe5a4feafe198e150dba316ce3881444967',
          storage: '0xdf18372bc9c588b96c7553bc811467a9166ed9be472b40cb45c226175377c558',
          incentiveV3: '0x5ddc7f50eff9396f3f401a6194dda7b64c2ffc64fd581d119c44ae0587119309',
          assetId: 1,
          isDefault: false
        },
        {
          name: 'ember',
          pool: '0x660194c215d84cf9ac1de39de440edc059671ce04ee8131374159472a791ff84',
          storage: '0xc2b6a52f0da7f91389eaffe4f68f4cacee43aa616bb8a4371118eafaf07cdd90',
          incentiveV3: '0x715f4d383c3fbc999c9a8030d540bf2348d65cac1cb6aa8e9fab31cd408bff55',
          assetId: 0,
          isDefault: false
        },
        {
          name: 'matrixdock',
          pool: '0xb2236866d2aacdd2368ffbb4c8afd6832e6a612aa7632fe13bdcdcd47db84208',
          storage: '0x199c1d5c2d58a4b05bbfa2338d02ad2676572a8a59ac148a5475b5c0fc53ed9f',
          incentiveV3: '0x98612a501041cb7b57edeae28b2029f55a294aae5736ab2dda629523125d7197',
          assetId: 0,
          isDefault: false
        },
        {
          name: 'sui-usdc',
          pool: '0x981de52ee841ac80387e0edd85c944197a273110043351e1bf5242b47c23abe8',
          storage: '0x51c5ad179214eb5e170dd93ba6f9b15948002caf85f7e2b091ef46d2dc2ce5b6',
          incentiveV3: '0x78b4a72683b9a36ea30877a27fd0040adbc0539fc11c2f2507fb560a83b82815',
          assetId: 1,
          isDefault: false
        }
      ],
      rewardRules: [
        {
          index: 0,
          naviPoolId: '0xa3582097b4c57630046c0c49a88bfc6b202a3ec0a9db5597c31765f7563755a8',
          incentiveRuleId: '0xae82946d6cae4d5e7a779325394959fd7c2505405de71b2c01a2aac6ec3ab9da',
          rewardCoinType:
            '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
          isVaultNative: false,
          isActive: true,
          mustCollectBeforeWithdraw: true,
          rewardFund: '0x7093cf7549d5e5b35bfde2177223d1050f71655c7f676a5e610ee70eb4d93b5c',
          storage: '0xbb4e2f4b6205c2e2a2db47aeb4f830796ec7c005f88537ee775986639bc442fe',
          incentiveV3: '0x62982dad27fb10bb314b3384d5de8d2ac2d72ab2dbeae5d801dbdb9efa816c80'
        },
        {
          index: 1,
          naviPoolId: '0x0000000000000000000000000000000000000000000000000000000000000000',
          incentiveRuleId: '0x0000000000000000000000000000000000000000000000000000000000000000',
          rewardCoinType:
            '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
          isVaultNative: true,
          isActive: false,
          mustCollectBeforeWithdraw: false,
          rewardFund: null,
          storage: null,
          incentiveV3: null
        }
      ]
    },
    {
      key: 'SUI_PRIME',
      displayName: 'SUI Prime',
      vault: '0x01236ff6c66c0c668950f9702629b42f372bf478793d055d2a7eca15e0b0d1e7',
      timelocks: '0x3f1533e62792cb686b3dd794d408a83a653a1f3b553224c70c7dfcc8b290dcf4',
      coinType: '0x2::sui::SUI',
      decimals: 9,
      markets: [
        {
          name: 'vsui-sui',
          pool: '0x3f2d878005dd9d5caf56467bc0c55f93bb5a3c83a5c7fb057032a0abf1bad4bf',
          storage: '0xafb982de1a436b1cc8a14ecd2d787762599b65d3a6b75b84b10939b1e17d9381',
          incentiveV3: '0x5a1d3333b37d206033bb49859d306e546cc8d9b81a0c854d899752227a91a2de',
          assetId: 1,
          isDefault: true
        },
        {
          name: 'hasui-sui',
          pool: '0xe75ea5ed5f37d8c86b1f2742dd408d380ab5845bb1aabeba8fbee38dd5824765',
          storage: '0x6b945adccadf11cd7ec39f8c2c225a4267004a74587871cac86f9fa3dbf3be63',
          incentiveV3: '0x036e2854c386099d3bb44533160079e13a2e081952065b37467f859c6b73eb64',
          assetId: 1,
          isDefault: false
        }
      ],
      rewardRules: []
    },
    {
      key: 'USDC_PRIME',
      displayName: 'USDC Prime',
      vault: '0x908c978d1a007aec4bcdc8233a0273de27ab059b9e6611bdad083457abb7f062',
      timelocks: '0x0aaebd50fbc34041706d2e153fbfe31b475f38e6055bb788340aa9eecba45364',
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      decimals: 6,
      markets: [
        {
          name: 'sui-usdc',
          pool: '0x981de52ee841ac80387e0edd85c944197a273110043351e1bf5242b47c23abe8',
          storage: '0x51c5ad179214eb5e170dd93ba6f9b15948002caf85f7e2b091ef46d2dc2ce5b6',
          incentiveV3: '0x78b4a72683b9a36ea30877a27fd0040adbc0539fc11c2f2507fb560a83b82815',
          assetId: 1,
          isDefault: true
        },
        {
          name: 'lzwbtc-usdc',
          pool: '0x04b66a9a2619d2c22b4845133945ab3e7e613a470af1c66861587a6e72fc3c32',
          storage: '0x79db6cdbfb59a067be7d78c1003079f56d817ac33b5d372b3165daf09f31ed69',
          incentiveV3: '0xf0263a942969226ec12fd81f1bac355d08150b4c0c730bd88a598ce8e8de1df9',
          assetId: 1,
          isDefault: false
        },
        {
          name: 'vsui-usdc',
          pool: '0xa5416a944ea690a26ef6cf1e3745dabd73f84d4143a741b2a2bb0e217f4f8d65',
          storage: '0x35fecf669e7794ad25d289c2a23f065e518351acae09c5032d7237e185257924',
          incentiveV3: '0xa7955f8aea32d8624b0c26c64c714a5c7abd3f5ef5a6a8b04bb35d5442f7c46b',
          assetId: 1,
          isDefault: false
        },
        {
          name: 'xbtc-usdc',
          pool: '0x8ef9ddbe70a3e796a5c191bb0418a2f1a03f5f6d10244bcc0c666826e066eb4b',
          storage: '0x7db5c000524bfe55bb2bc343886f29eabc38f706dc1655900055fa5b60ee00a5',
          incentiveV3: '0xfc707b0a65ccf21cba1a7c8e0fa4dbabfdda605a8f3b957c8dcf19aa3921315f',
          assetId: 1,
          isDefault: false
        }
      ],
      rewardRules: []
    }
  ]
}
