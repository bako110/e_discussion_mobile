package com.ediscussion

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Exemption Doze/optimisation batterie — SANS elle, certains OEM (Transsion/
 * Infinix/Tecno notamment) coupent silencieusement la connexion FCM en
 * arrière-plan : aucun push ne parvient jamais à l'appareil, même envoyé
 * avec succès par le serveur. `Linking.sendIntent` de React Native ne
 * permet pas de fournir l'URI `package:<id>` requise par
 * `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` -> module natif minimal.
 */
class BatteryOptModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "BatteryOptModule"

  /** true si l'app est DÉJÀ exemptée des optimisations batterie. */
  @ReactMethod
  fun isIgnoringBatteryOptimizations(promise: Promise) {
    try {
      val pm = reactApplicationContext.getSystemService(android.content.Context.POWER_SERVICE) as PowerManager
      val ignoring = pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName)
      promise.resolve(ignoring)
    } catch (e: Exception) {
      promise.reject("battery_opt_check_failed", e)
    }
  }

  /**
   * Ouvre la boîte de dialogue système demandant l'exemption pour CETTE app.
   * L'utilisateur peut refuser — pas de garantie, juste une invite native
   * standard (utilisée par WhatsApp/Telegram/Signal pour la même raison).
   */
  @ReactMethod
  fun requestIgnoreBatteryOptimizations(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("battery_opt_request_failed", e)
    }
  }

  /** Filet de secours : écran général des paramètres batterie de l'app,
   * pour les OEM (Transsion notamment) où l'action système standard ne
   * suffit pas et où l'utilisateur doit activer un réglage constructeur
   * additionnel (ex. « Démarrage automatique » / « Sans restriction »). */
  @ReactMethod
  fun openAppSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("open_app_settings_failed", e)
    }
  }

  /**
   * Ouvre directement les réglages du canal de notification donné (Android
   * 8+ uniquement — en dessous, pas de canaux : no-op côté JS). Sert
   * notamment à la notif permanente du foreground service
   * (`BackgroundKeepAliveService.CHANNEL_ID = "keepalive_v1"`) : elle ne peut
   * PAS être masquée par du code (Android l'exige tant que le service
   * tourne), seul l'utilisateur peut la couper depuis ce panneau système.
   */
  @ReactMethod
  fun openNotificationChannelSettings(channelId: String, promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).apply {
        putExtra(Settings.EXTRA_APP_PACKAGE, reactApplicationContext.packageName)
        putExtra(Settings.EXTRA_CHANNEL_ID, channelId)
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("open_channel_settings_failed", e)
    }
  }

  /**
   * true si l'app est autorisée à afficher une notification PLEIN ÉCRAN
   * (nécessaire pour que l'appel entrant sonne façon "vrai appel" plutôt que
   * de rester une simple notification cliquable). Depuis Android 14 (API 34),
   * cette permission n'est PLUS accordée automatiquement à l'installation
   * pour les apps ciblant le SDK 34+ : sans autorisation explicite de
   * l'utilisateur dans les réglages système, `fullScreenAction` est
   * silencieusement dégradé par l'OS en notification normale — aucune erreur
   * ni log côté app, juste un appel qui ne "sonne" plus jamais en plein écran.
   * Toujours `true` en dessous d'Android 14 (permission historique automatique).
   */
  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        promise.resolve(true)
        return
      }
      val nm = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      promise.resolve(nm.canUseFullScreenIntent())
    } catch (e: Exception) {
      promise.reject("full_screen_intent_check_failed", e)
    }
  }

  /** Ouvre l'écran système où l'utilisateur autorise (ou révoque) la
   * notification plein écran pour cette app (Android 14+ uniquement). */
  @ReactMethod
  fun openFullScreenIntentSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        promise.resolve(false)
        return
      }
      val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        flags = Intent.FLAG_ACTIVITY_NEW_TASK
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("open_full_screen_intent_settings_failed", e)
    }
  }
}
