# @naviprotocol/vault

TypeScript SDK framework for NAVI Lending and Volo Vault integrations on Sui.

The minimal `Vault` projection contains `id`, `app`, `protocol`, `contractConfig`, and
`assets`. `app` identifies the product surface, while `protocol` selects the contract PTB
implementation.

The public SDK exposes `sdk.vaults` for vault discovery and `sdk.user` for positions and PTB
builders. Protocol-specific PTB interfaces live under `protocols/navi-lending` and
`protocols/volo-vault`. All operations are intentionally left unimplemented.
