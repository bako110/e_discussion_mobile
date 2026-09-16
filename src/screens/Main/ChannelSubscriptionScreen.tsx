/**
 * Abonnement payant d'une chaîne — structure de données seulement : prix +
 * devise, aucun encaissement réel pour l'instant (pas de prestataire de
 * paiement branché). Réutilise `groupService.setSettings` comme les autres
 * réglages de chaîne.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showSheet, showToast } from '@/components/common';
import { SettingsSection } from '@/components/settings';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import { ApiError } from '@/api';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import type { GroupSettings } from '@/types';

const CURRENCIES = ['XOF', 'EUR', 'USD'];

export const ChannelSubscriptionScreen: React.FC<MainScreenProps<'ChannelSubscription'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { reload: reloadGroups } = useGroups();
  const c = theme.colors;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isPaid, setIsPaid] = useState(false);
  const [priceInput, setPriceInput] = useState('');
  const [currency, setCurrency] = useState('XOF');

  useEffect(() => {
    let alive = true;
    groupService
      .getSettings(groupId)
      .then((s: GroupSettings) => {
        if (!alive) return;
        setIsPaid(s.is_paid);
        setCurrency(s.subscription_currency ?? 'XOF');
        setPriceInput(
          s.subscription_price_cents != null ? String(s.subscription_price_cents / 100) : '',
        );
      })
      .catch(() => showToast(t('errors.generic'), { type: 'error' }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId, t]);

  const pickCurrency = () => {
    showSheet({
      title: t('groupSettings.subscriptionCurrency'),
      actions: CURRENCIES.map((cur) => ({
        label: cur + (cur === currency ? '  ✓' : ''),
        onPress: () => setCurrency(cur),
      })),
    });
  };

  const save = async (nextIsPaid: boolean) => {
    const priceValue = parseFloat(priceInput.replace(',', '.'));
    if (nextIsPaid && (!priceInput.trim() || Number.isNaN(priceValue) || priceValue <= 0)) {
      showToast(t('groupSettings.subscriptionPriceRequired'), { type: 'error' });
      return;
    }
    setSaving(true);
    try {
      await groupService.setSettings(groupId, {
        is_paid: nextIsPaid,
        subscription_price_cents: nextIsPaid ? Math.round(priceValue * 100) : null,
        subscription_currency: nextIsPaid ? currency : null,
      });
      setIsPaid(nextIsPaid);
      void reloadGroups();
      showToast(t('groupSettings.saved'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        showToast(t('groupSettings.deniedShort'), { type: 'error' });
      } else {
        showToast(t('groupSettings.saveFailed'), { type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('groupSettings.ch_subscription')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <SettingsSection>
            <View style={[styles.toggleRow, { borderBottomColor: c.divider }]}>
              <Icon name="star-circle-outline" size={20} color={c.textMuted} />
              <Text style={[styles.toggleLabel, { color: c.text }]}>
                {t('groupSettings.subscriptionEnable')}
              </Text>
              <Switch
                value={isPaid}
                onValueChange={(v) => void save(v)}
                disabled={saving}
                trackColor={{ true: c.primary, false: c.border }}
                thumbColor="#fff"
              />
            </View>
          </SettingsSection>

          {isPaid ? (
            <SettingsSection title={t('groupSettings.subscriptionPrice')}>
              <View style={styles.priceRow}>
                <TextInput
                  value={priceInput}
                  onChangeText={setPriceInput}
                  onBlur={() => void save(true)}
                  placeholder="0"
                  placeholderTextColor={c.textFaint}
                  keyboardType="decimal-pad"
                  style={[styles.priceInput, { color: c.text }]}
                />
                <Pressable
                  onPress={pickCurrency}
                  style={[styles.currencyBtn, { borderColor: c.border }]}
                >
                  <Text style={{ color: c.text, fontWeight: '700' }}>{currency}</Text>
                  <Icon name="chevron-down" size={16} color={c.textMuted} />
                </Pressable>
              </View>
            </SettingsSection>
          ) : null}

          {saving ? <ActivityIndicator style={{ marginTop: 12 }} color={c.primary} /> : null}
          <Text style={[styles.note, { color: c.textFaint }]}>
            {t('groupSettings.subscriptionNote')}
          </Text>
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
  },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 },
  priceInput: { flex: 1, fontSize: 20, fontWeight: '700', paddingVertical: 6 },
  currencyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
