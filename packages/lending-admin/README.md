# @naviprotocol/lending-admin

NAVI Lending Admin SDK provides typed transaction builders for privileged lending operations on Sui.

## Installation

```npm
npm install @naviprotocol/lending-admin
```

## Scope

This package focuses on admin-side PTB builders for:
- on-behalf account operations
- market and reserve administration
- emode configuration
- flash-loan configuration
- incentive and risk controls

## Notes

- This package only builds transaction commands; it does not execute transactions.
- Use admin capabilities carefully and only in controlled environments.
