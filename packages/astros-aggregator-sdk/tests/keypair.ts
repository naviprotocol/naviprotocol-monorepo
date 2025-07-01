import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import dotenv from 'dotenv'

dotenv.config()

const keypair = !!process.env.MNEMONIC
  ? Ed25519Keypair.deriveKeypair(process.env.MNEMONIC)
  : Ed25519Keypair.generate()

export { keypair }
