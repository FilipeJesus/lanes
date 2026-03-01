package com.lanes.intellij.bridge

/**
 * Thin abstraction for JSON-RPC requests.
 *
 * Used to keep UI components testable without having to spawn a real bridge process.
 */
interface BridgeRequester {
    suspend fun <T> request(method: String, params: Any?, resultType: Class<T>): T
}

class BridgeClientRequester(private val client: BridgeClient) : BridgeRequester {
    override suspend fun <T> request(method: String, params: Any?, resultType: Class<T>): T {
        return client.request(method, params, resultType)
    }
}
