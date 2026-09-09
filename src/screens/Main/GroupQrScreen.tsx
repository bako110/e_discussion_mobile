import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import type { Group } from '@/types';

/** Lien d'invitation encodé dans le QR (résolu par ScannerScreen). */
export const inviteLink = (code: string) => `gofolyx://join/${code}`;

/**
 * QR code d'invitation d'un groupe / chaîne — à faire scanner par quelqu'un
 * pour qu'il rejoigne. Bouton de partage du lien en complément.
 */
export const GroupQrScreen: React.FC<MainScreenProps<'GroupQr'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    groupService
      .get(groupId)
      .then((g) => alive && setGroup(g))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [groupId]);

  const link = group ? inviteLink(group.invite_code) : '';
  const isChannel = group?.kind === 'channel';

  const share = async () => {
    if (!group) return;
    try {
      await Share.share({
        message: t('groups.shareInviteText', { name: group.name, link }),
      });
    } catch {
      /* annulé */
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('groups.inviteQr')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
      />

      {loading || !group ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <View style={styles.body}>
          <Avatar uri={group.avatar_url} name={group.name} size={72} />
          <Text style={[styles.name, { color: c.text }]}>{group.name}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>
            {isChannel
              ? t('groups.subscribersCount', { count: group.member_count })
              : t('groups.membersCount', { count: group.member_count })}
          </Text>

          <View style={[styles.qrCard, { backgroundColor: '#fff', borderColor: c.border }]}>
            <QRCode
              value={link}
              size={220}
              backgroundColor="#fff"
              color="#0F1B3D"
            />
          </View>

          <Text style={[styles.hint, { color: c.textMuted }]}>
            {t('groups.qrHint')}
          </Text>

          <View style={[styles.linkBox, { backgroundColor: c.surfaceAlt }]}>
            <Icon name="link-variant" size={16} color={c.textMuted} />
            <Text style={[styles.linkText, { color: c.text }]} numberOfLines={1}>
              {link}
            </Text>
          </View>

          <Pressable onPress={share} style={[styles.shareBtn, { backgroundColor: c.primary }]}>
            <Icon name="share-variant" size={18} color="#fff" />
            <Text style={styles.shareText}>{t('groups.shareInvite')}</Text>
          </Pressable>
        </View>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, alignItems: 'center', paddingTop: 24, paddingHorizontal: 30, gap: 6 },
  name: { fontSize: 20, fontWeight: '800', marginTop: 8 },
  sub: { fontSize: 13 },
  qrCard: {
    marginTop: 22,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    elevation: 3,
    shadowColor: '#1B2B4B',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  hint: { fontSize: 13, textAlign: 'center', marginTop: 18 },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    alignSelf: 'stretch',
  },
  linkText: { flex: 1, fontSize: 13, fontWeight: '600' },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 24,
  },
  shareText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
