package com.ediscussion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Service de fond PERSISTANT (foreground service), façon WhatsApp/Telegram.
 *
 * Un simple push FCM data-only ou une connexion WebSocket ne suffisent pas
 * sur les OEM agressifs (Transsion/Infinix/Tecno notamment) : le processus
 * JS de l'app est tué quelques secondes après son passage en arrière-plan,
 * quelle que soit l'exemption batterie accordée. Un foreground service, lui,
 * a une priorité bien plus haute dans le gestionnaire de mémoire/énergie —
 * le système le préserve beaucoup plus longtemps.
 *
 * La notification associée est VOLONTAIREMENT discrète (icône fixe, pas de
 * son/vibration, importance LOW) : elle n'a pour but que de justifier la
 * présence du service auprès du système, pas d'alerter l'utilisateur.
 * Démarré/arrêté depuis JS (voir BackgroundKeepAliveModule) quand l'app
 * passe en arrière-plan / repasse au premier plan.
 */
class BackgroundKeepAliveService : Service() {

  companion object {
    const val CHANNEL_ID = "keepalive_v1"
    const val NOTIF_ID = 42
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createChannelIfNeeded()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIF_ID, buildNotification())
    // START_STICKY : si le système tue quand même le process, il retente de
    // relancer le service dès que possible (sans garantie sur tous les OEM,
    // mais c'est le comportement recommandé pour ce cas d'usage).
    return START_STICKY
  }

  private fun buildNotification(): Notification {
    val openAppIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      this, 0, openAppIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(getString(R.string.app_name))
      .setContentText("Actif — vous recevrez vos messages")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .setSilent(true)
      .setContentIntent(pendingIntent)
      .build()
  }

  private fun createChannelIfNeeded() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Maintien en arrière-plan",
      NotificationManager.IMPORTANCE_MIN,
    ).apply {
      description = "Garde l'application active pour recevoir vos messages"
      setShowBadge(false)
    }
    nm.createNotificationChannel(channel)
  }
}
