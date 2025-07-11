/**
 * Custom Transport Implementation
 *
 * This module provides a custom transport layer for communicating with the Sui blockchain.
 * It implements the SuiTransport interface and provides error handling and request
 * management for RPC calls to Sui nodes.
 *
 * @module CustomTransport
 */

import axios from 'axios'
import { type SuiTransport, type SuiTransportRequestOptions } from '@mysten/sui/client'

/**
 * Axios instance with custom configuration
 *
 * This instance is configured with a timeout and response interceptors
 * for handling Sui RPC-specific error responses.
 */
const instance = axios.create({
  timeout: 20000
})

/**
 * Response interceptor for handling Sui RPC errors
 *
 * This interceptor checks for error responses from the Sui RPC endpoint
 * and throws appropriate errors for different error formats.
 */
instance.interceptors.response.use(
  function (response) {
    // Check for Sui RPC error format
    if (response.data.err) {
      throw new Error(response.data.err)
    }
    // Check for standard error format
    if (response.data.error) {
      throw new Error(response.data.error.message)
    }
    return response
  },
  function (error) {
    return Promise.reject(error)
  }
)

/**
 * Custom transport implementation for Sui blockchain communication
 *
 * This class implements the SuiTransport interface and provides
 * a custom HTTP transport layer for making RPC calls to Sui nodes.
 * It includes request ID management and proper JSON-RPC 2.0 formatting.
 */
export class CustomTransport implements SuiTransport {
  /** Counter for generating unique request IDs */
  requestId = 0

  /** RPC endpoint URL for the Sui node */
  rpcUrl: string

  /**
   * Creates a new custom transport instance
   *
   * @param rpcUrl - The RPC endpoint URL for the Sui node
   */
  constructor(rpcUrl: string) {
    this.rpcUrl = rpcUrl
  }

  /**
   * Makes an RPC request to the Sui node
   *
   * This method formats the request according to JSON-RPC 2.0 specification
   * and sends it to the configured RPC endpoint.
   *
   * @param input - The transport request options containing method and parameters
   * @returns Promise<T> - The response data from the RPC call
   */
  async request<T>(input: SuiTransportRequestOptions): Promise<T> {
    // Increment request ID for unique identification
    this.requestId += 1

    // Make the RPC request with proper JSON-RPC 2.0 formatting
    const res = await instance.post(this.rpcUrl, {
      jsonrpc: '2.0',
      id: this.requestId,
      method: input.method,
      params: input.params
    })

    return res.data.result
  }

  /**
   * Subscribe to events (not implemented)
   *
   * This method is required by the SuiTransport interface but is not
   * implemented in this custom transport. It throws an error if called.
   *
   * @returns Promise<() => Promise<boolean>> - Unsubscribe function
   * @throws Error - Always throws "subscribe not implemented" error
   */
  async subscribe<T>(): Promise<() => Promise<boolean>> {
    throw new Error('subscribe not implemented.')
  }
}
