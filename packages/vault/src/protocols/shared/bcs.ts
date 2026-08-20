import { bcs } from '@mysten/sui/bcs'

/**
 * A vault receipt, as both protocols define it: `{ id: UID, vault_* : address }`.
 *
 * A `UID` wraps a single address and serializes as 32 raw bytes with no framing, so the
 * whole struct is exactly two addresses. BCS is positional, so the same schema decodes
 * `navi_vault::Receipt` (`vault_address`) and `volo_vault::receipt::Receipt` (`vault_id`)
 * alike.
 *
 * Neither type is generic: one type covers every vault on its deployment, which is why
 * the second field has to be read to attribute a receipt.
 */
export const ReceiptStruct = bcs.struct('Receipt', {
  id: bcs.Address,
  vaultId: bcs.Address
})
