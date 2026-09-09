import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { deviceService } from '@/services';
import type { LinkedDevice } from '@/types';
import { relativeTime } from '@/utils/time';

/**
 * « Appareils liés » — liste des appareils enregistrés pour l'E2E, avec
 * possibilité de révoquer un appareil (hors l'appareil courant).
 */
export const DevicesScreen: React.FC<MainScreenProps<'Devices'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [devices, setDevices] = useState<LinkedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await deviceService.list());
    } catch {
      /* hors-ligne */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirmRevoke = (d: LinkedDevice) => {
    Alert.alert(t('settings.revokeDeviceTitle'), t('settings.revokeDeviceConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.revoke'),
        style: 'destructive',
        onPress: async () => {
          try {
            await deviceService.revoke(d.device_id);
            await load();
          } catch {
            Alert.alert(t('errors.generic'));
          }
        },
      },
    ]);
  };

  const active = devices.filter((d) => !d.revoked);
  const revoked = devices.filter((d) => d.revoked);

  const renderDevice = (d: LinkedDevice) => (
    <View key={d.device_id} style={styles.row}>
      <View style={[styles.icon, { backgroundColor: c.surfaceAlt }]}>
        <Icon
          name={d.is_current ? 'cellphone-check' : 'cellphone'}
          size={20}
          color={d.is_current ? c.primary : c.textMuted}
        />
      </View>
      <View style={styles.body}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {d.device_label || t('settings.unknownDevice')}
          {d.is_current ? ` · ${t('settings.thisDevice')}` : ''}
        </Text>
        <Text style={[styles.sub, { color: c.textMuted }]}>
          {t('settings.linkedOn', { when: relativeTime(d.created_at) })}
          {d.revoked ? ` · ${t('settings.revoked')}` : ''}
        </Text>
      </View>
      {!d.is_current && !d.revoked ? (
        <Pressable onPress={() => confirmRevoke(d)} hitSlop={8} style={styles.revokeBtn}>
          <Icon name="close-circle-outline" size={20} color={c.danger} />
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.linkedDevices')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await load();
                setRefreshing(false);
              }}
              tintColor={c.primary}
            />
          }
        >
          <Text style={[styles.hint, { color: c.textMuted }]}>
            {t('settings.devicesHint')}
          </Text>

          {active.map(renderDevice)}

          {revoked.length > 0 ? (
            <>
              <Text style={[styles.section, { color: c.textMuted }]}>
                {t('settings.revokedDevices')}
              </Text>
              {revoked.map(renderDevice)}
            </>
          ) : null}

          {devices.length === 0 ? (
            <Text style={[styles.empty, { color: c.textMuted }]}>
              {t('settings.noDevices')}
            </Text>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 40 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  revokeBtn: { padding: 4 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 22,
    marginBottom: 4,
  },
  empty: { textAlign: 'center', paddingVertical: 30, fontSize: 14 },
});
