package com.lanes.intellij.adapters

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.intellij.openapi.Disposable
import com.lanes.intellij.bridge.BridgeClient
import com.lanes.intellij.bridge.ConfigGetParams
import com.lanes.intellij.bridge.ConfigGetResult
import com.lanes.intellij.bridge.ConfigMethods
import com.lanes.intellij.bridge.ConfigSetParams
import com.lanes.intellij.bridge.ConfigSetResult
import kotlinx.coroutines.CancellationException

/**
 * Adapter for configuration management via the bridge.
 *
 * Delegates to the Node.js bridge for reading/writing configuration.
 * All methods are suspend functions to avoid EDT deadlocks.
 */
class ConfigAdapter(private val client: BridgeClient) {

    private val gson = Gson()

    /**
     * Get a configuration value.
     *
     * @param section Configuration section (e.g., "lanes")
     * @param key Configuration key
     * @param defaultValue Default value if not set
     * @return Configuration value or default
     */
    suspend fun <T> get(section: String, key: String, defaultValue: T): T {
        val fullKey = "$section.$key"
        return try {
            val result = client.request(
                ConfigMethods.GET,
                ConfigGetParams(fullKey),
                ConfigGetResult::class.java
            )

            @Suppress("UNCHECKED_CAST")
            if (result.value != null && !result.value.isJsonNull) {
                when (defaultValue) {
                    is String -> result.value.asString as T
                    is Int -> result.value.asInt as T
                    is Boolean -> result.value.asBoolean as T
                    is Double -> result.value.asDouble as T
                    is Long -> result.value.asLong as T
                    else -> gson.fromJson(result.value, defaultValue!!::class.java) as T
                }
            } else {
                defaultValue
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            defaultValue
        }
    }

    /**
     * Set a configuration value.
     *
     * @param section Configuration section (e.g., "lanes")
     * @param key Configuration key
     * @param value Value to set
     */
    suspend fun <T> set(section: String, key: String, value: T) {
        val fullKey = "$section.$key"
        val jsonValue: JsonElement = gson.toJsonTree(value)

        client.request(
            ConfigMethods.SET,
            ConfigSetParams(fullKey, jsonValue),
            ConfigSetResult::class.java
        )
    }

    /**
     * Register a callback for configuration changes.
     *
     * Note: This relies on the bridge sending config change notifications.
     * The notification format should be: { section, key }
     *
     * @param section Configuration section to watch
     * @param callback Callback to invoke when config changes
     * @return Disposable to unregister the callback
     */
    fun onDidChange(section: String, callback: () -> Unit): Disposable {
        return client.onNotification("notification.configChanged") { params ->
            val changedSection = params.get("section")?.asString
            if (changedSection == section) {
                callback()
            }
        }
    }
}
