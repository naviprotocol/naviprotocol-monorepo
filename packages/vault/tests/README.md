# Vault mainnet tests

These integration tests use only live Open API and Sui mainnet data. Wallets are discovered from
recent on-chain deposit events and verified against their current receipts and balances. PTBs are
simulated and never signed or submitted.

Run the tests:

```sh
pnpm --filter @naviprotocol/vault test:mainnet
```

Generate the default standalone HTML report at
`packages/vault/test-reports/vault-mainnet-report.html`:

```sh
pnpm --filter @naviprotocol/vault test:mainnet:report
```

The report destination can also be selected explicitly:

```sh
VAULT_TEST_REPORT=stdout pnpm --filter @naviprotocol/vault test:mainnet
VAULT_TEST_REPORT=/tmp/vault-report.html pnpm --filter @naviprotocol/vault test:mainnet
```

The interface tests are split under `tests/mainnet/`. `mainnet.test.ts` is only the shared entrypoint;
each `*.cases.ts` file covers the SDK interface named by the file.

The HTML report can filter by interface or status and search by keyword. Test data and raw BCS are
collapsible, decoded dry-run events are displayed individually, and balance changes are shown as a
table. Each case includes its purpose, exact chain-derived inputs, assertion rules, and result. A
cancellation case is reported as skipped, together with the observed chain data and reason, when no
real cancellable request exists at run time.
