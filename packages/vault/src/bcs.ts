/**
 * Vault BCS Schemas
 *
 * BCS layouts for vault objects read as raw Move struct content.
 *
 * @module VaultBcs
 */

import { bcs } from '@mysten/sui/bcs'

/**
 * `navi_vault::Receipt`.
 *
 * The struct is `{ id: UID, vault_address: address }`. A `UID` is a `sui::object::ID`
 * wrapping a single address, so it serializes as 32 raw bytes with no framing — the
 * whole struct is exactly two addresses.
 *
 * `Receipt` is deliberately not generic: one type covers every vault on the deployment,
 * which is why {@link ReceiptStruct.vault_address} has to be read to attribute it.
 */
export const ReceiptStruct = bcs.struct('Receipt', {
  id: bcs.Address,
  vault_address: bcs.Address
})
