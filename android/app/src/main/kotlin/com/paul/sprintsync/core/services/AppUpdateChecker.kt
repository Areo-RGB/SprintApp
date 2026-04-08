package com.paul.sprintsync.core.services

import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.URL

class AppUpdateChecker(private val context: Context) {

    companion object {
        private const val TAG = "AppUpdateChecker"
    }

    data class UpdateInfo(
        val versionCode: Int,
        val versionName: String,
        val apkUrl: String,
        val releaseNotes: String,
    )

    /**
     * Checks the GitHub Releases API for a newer version.
     * Returns UpdateInfo if an update is available, null otherwise.
     * The GitHub release tag_name must be the versionCode integer (e.g. "2" or "v2").
     */
    suspend fun checkForUpdate(
        updateCheckUrl: String,
        currentVersionCode: Int,
    ): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val json = URL(updateCheckUrl).readText()
            val obj = JSONObject(json)
            val tagName = obj.getString("tag_name") // e.g. "v2" or "2"
            val remoteVersionCode = tagName.removePrefix("v").toIntOrNull()
            if (remoteVersionCode == null) {
                Log.w(TAG, "Could not parse versionCode from tag: $tagName")
                return@withContext null
            }
            if (remoteVersionCode <= currentVersionCode) {
                Log.d(TAG, "App is up to date (local=$currentVersionCode, remote=$remoteVersionCode)")
                return@withContext null
            }
            val assets = obj.getJSONArray("assets")
            val apkAsset = (0 until assets.length())
                .map { assets.getJSONObject(it) }
                .firstOrNull { it.getString("name").endsWith(".apk") }
            if (apkAsset == null) {
                Log.w(TAG, "No APK asset found in release $tagName")
                return@withContext null
            }
            UpdateInfo(
                versionCode = remoteVersionCode,
                versionName = obj.optString("name", tagName),
                apkUrl = apkAsset.getString("browser_download_url"),
                releaseNotes = obj.optString("body", ""),
            )
        } catch (e: Exception) {
            Log.e(TAG, "Update check failed", e)
            null
        }
    }

    /**
     * Downloads the APK from the given URL and triggers the Android package installer.
     * Returns true if the install intent was launched successfully.
     */
    suspend fun downloadAndInstall(apkUrl: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val file = File(context.getExternalFilesDir(null), "update.apk")
            URL(apkUrl).openStream().use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            val uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                file,
            )
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e(TAG, "Download/install failed", e)
            false
        }
    }
}
