/**
 * Paramètres d'un groupe / d'une chaîne (admins uniquement) — façon WhatsApp.
 * Tous les réglages liés au groupe : qui peut écrire, qui peut modifier les
 * infos, qui peut ajouter des membres, adhésion sous approbation, ce qu'on
 * montre pour l'invitation, disparition des messages.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showSheet, showToast } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { ApiError } from '@/api';
import { groupService } from '@/services';
import type { GroupSettings } from '@/types';

type Policy = 'all' | 'admins';

const DISAPPEAR: { s: number; key: string }[] = [
  { s: 0, key: 'off' },
  { s: 86400, key: 'd1' },
  { s: 604800, key: 'd7' },
  { s: 7776000, key: 'd90' },
];

export const GroupSettingsScreen: React.FC<MainScreenProps<'GroupSettings'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { reload: reloadGroups } = useGroups();
  const c = theme.colors;

  const [s, setS] = useState<GroupSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(0);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      groupService.getSettings(groupId),
      groupService.joinRequests(groupId).catch(() => []),
    ])
      .then(([cfg, reqs]) => {
        if (!alive) return;
        setS(cfg);
        setPending(reqs.length);
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 403) setDenied(true);
        else showToast(t('errors.generic'), { type: 'error' });
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId, t]);

  const patch = async (p: Partial<GroupSettings>) => {
    if (!s) return;
    const prev = s;
    setS({ ...s, ...p });
    setSaving(true);
    try {
      await groupService.setSettings(groupId, p);
      void reloadGroups();
      showToast(t('groupSettings.saved'));
    } catch (e) {
      setS(prev); // rollback
      if (e instanceof ApiError && e.status === 403) {
        setDenied(true);
        showToast(t('groupSettings.deniedShort'), { type: 'error' });
      } else {
        showToast(t('groupSettings.saveFailed'), { type: 'error' });
      }
    } finally {
      setSaving(false);
    }
  };

  const pickPolicy = (
    title: string,
    current: Policy,
    apply: (v: Policy) => void,
  ) => {
    showSheet({
      title,
      actions: (['all', 'admins'] as Policy[]).map((v) => ({
        label: t(`groupSettings.policy_${v}`) + (v === current ? '  ✓' : ''),
        icon: v === 'admins' ? 'shield-account-outline' : 'account-multiple-outline',
        onPress: () => apply(v),
      })),
    });
  };

  const pickDisappear = () => {
    showSheet({
      title: t('groupSettings.disappearing'),
      actions: DISAPPEAR.map(({ s: sec, key }) => ({
        label:
          t(`groupSettings.disappear_${key}`) +
          (s?.disappearing_seconds === sec ? '  ✓' : ''),
        icon: sec === 0 ? 'timer-off-outline' : 'timer-outline',
        onPress: () => void patch({ disappearing_seconds: sec }),
      })),
    });
  };

  const pickInviteVis = () => {
    showSheet({
      title: t('groupSettings.inviteVisibility'),
      actions: (['both', 'link', 'code'] as const).map((v) => ({
        label:
          t(`groupSettings.invite_${v}`) + (s?.invite_visibility === v ? '  ✓' : ''),
        onPress: () => void patch({ invite_visibility: v }),
      })),
    });
  };

  const policyLabel = (v: Policy) => t(`groupSettings.policy_${v}`);
  const disappearLabel = () => {
    const d = DISAPPEAR.find((x) => x.s === (s?.disappearing_seconds ?? 0)) ?? DISAPPEAR[0];
    return t(`groupSettings.disappear_${d.key}`);
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('groupSettings.title')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      {denied ? (
        <View style={styles.denied}>
          <Icon name="shield-lock-outline" size={44} color={c.textFaint} />
          <Text style={[styles.deniedTitle, { color: c.text }]}>
            {t('groupSettings.deniedTitle')}
          </Text>
          <Text style={[styles.deniedBody, { color: c.textMuted }]}>
            {t('groupSettings.deniedBody')}
          </Text>
        </View>
      ) : loading || !s ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <SettingsSection title={t('groupSettings.permissions')}>
            <SettingsRow
              icon="message-text-outline"
              label={t('groupSettings.sendMessages')}
              value={policyLabel(s.send_messages_policy)}
              onPress={() =>
                pickPolicy(t('groupSettings.sendMessages'), s.send_messages_policy, (v) =>
                  void patch({ send_messages_policy: v }),
                )
              }
            />
            <SettingsRow
              icon="pencil-outline"
              label={t('groupSettings.editInfo')}
              value={policyLabel(s.edit_info_policy)}
              onPress={() =>
                pickPolicy(t('groupSettings.editInfo'), s.edit_info_policy, (v) =>
                  void patch({ edit_info_policy: v }),
                )
              }
            />
            <SettingsRow
              icon="account-plus-outline"
              label={t('groupSettings.addMembers')}
              value={policyLabel(s.add_members_policy)}
              onPress={() =>
                pickPolicy(t('groupSettings.addMembers'), s.add_members_policy, (v) =>
                  void patch({ add_members_policy: v }),
                )
              }
              last
            />
          </SettingsSection>

          <SettingsSection title={t('groupSettings.membership')}>
            <View style={[styles.toggleRow, { borderBottomColor: c.divider }]}>
              <Icon name="account-check-outline" size={20} color={c.textMuted} />
              <Text style={[styles.toggleLabel, { color: c.text }]}>
                {t('groupSettings.approveNewMembers')}
              </Text>
              <Switch
                value={s.join_approval_required}
                onValueChange={(v) => void patch({ join_approval_required: v })}
                disabled={saving}
                trackColor={{ true: c.primary, false: c.border }}
                thumbColor="#fff"
              />
            </View>
            {s.join_approval_required ? (
              <SettingsRow
                icon="account-clock-outline"
                label={t('groupSettings.pendingRequests')}
                value={pending > 0 ? String(pending) : t('groupSettings.none')}
                onPress={() => navigation.navigate('GroupJoinRequests', { groupId })}
                last
              />
            ) : null}
          </SettingsSection>

          <SettingsSection title={t('groupSettings.invite')}>
            <SettingsRow
              icon="link-variant"
              label={t('groupSettings.inviteVisibility')}
              value={t(`groupSettings.invite_${s.invite_visibility}`)}
              onPress={pickInviteVis}
              last
            />
          </SettingsSection>

          <SettingsSection title={t('groupSettings.messages')}>
            <SettingsRow
              icon="timer-sand"
              label={t('groupSettings.disappearing')}
              value={disappearLabel()}
              onPress={pickDisappear}
              last
            />
          </SettingsSection>

          {saving ? (
            <ActivityIndicator style={{ marginTop: 12 }} color={c.primary} />
          ) : null}
          <Text style={[styles.note, { color: c.textFaint }]}>
            {t('groupSettings.note')}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
  denied: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  deniedTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  deniedBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
