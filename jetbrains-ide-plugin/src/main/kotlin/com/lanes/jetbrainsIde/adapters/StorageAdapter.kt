package com.lanes.jetbrainsIde.adapters

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.diagnostic.Logger
import com.intellij.util.xmlb.XmlSerializerUtil
import java.nio.file.Paths

/**
 * Adapter for persistent storage using IntelliJ Platform APIs.
 *
 * Provides workspace-level state persistence and global storage path.
 */
@Service(Service.Level.PROJECT)
@State(
    name = "LanesStorage",
    storages = [Storage("lanes-storage.xml")]
)
class StorageAdapter : PersistentStateComponent<StorageAdapter.State> {

    private val logger = Logger.getInstance(StorageAdapter::class.java)
    private val gson = Gson()

    private var state = State()

    /**
     * State container for persistent storage.
     */
    data class State(
        var data: MutableMap<String, String> = mutableMapOf()
    )

    /**
     * Get the global storage path.
     *
     * @return Path to global storage directory
     */
    fun getGlobalStoragePath(): String {
        val systemPath = com.intellij.openapi.application.PathManager.getSystemPath()
        return Paths.get(systemPath, "lanes").toString()
    }

    /**
     * Get a workspace state value.
     *
     * @param key State key
     * @param defaultValue Default value if key not found
     * @return State value or default
     */
    fun getWorkspaceState(key: String, defaultValue: String = ""): String {
        return state.data[key] ?: defaultValue
    }

    /**
     * Get a workspace state value as JSON.
     *
     * @param key State key
     * @param defaultValue Default JSON element if key not found
     * @return State value as JsonElement or default
     */
    fun getWorkspaceStateJson(key: String, defaultValue: JsonElement? = null): JsonElement? {
        val value = state.data[key] ?: return defaultValue
        return try {
            gson.fromJson(value, JsonElement::class.java)
        } catch (e: Exception) {
            logger.error("Failed to parse stored value as JSON for key: $key", e)
            defaultValue
        }
    }

    /**
     * Set a workspace state value.
     *
     * @param key State key
     * @param value State value
     */
    fun setWorkspaceState(key: String, value: String) {
        state.data[key] = value
    }

    /**
     * Set a workspace state value from JSON.
     *
     * @param key State key
     * @param value JSON element to store
     */
    fun setWorkspaceStateJson(key: String, value: JsonElement) {
        state.data[key] = gson.toJson(value)
    }

    /**
     * Remove a workspace state value.
     *
     * @param key State key
     */
    fun removeWorkspaceState(key: String) {
        state.data.remove(key)
    }

    /**
     * Clear all workspace state.
     */
    fun clearWorkspaceState() {
        state.data.clear()
    }

    // PersistentStateComponent implementation

    override fun getState(): State {
        return state
    }

    override fun loadState(state: State) {
        XmlSerializerUtil.copyBean(state, this.state)
    }
}
