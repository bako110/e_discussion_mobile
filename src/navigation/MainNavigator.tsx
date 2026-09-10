import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AboutSettingsScreen } from '@/screens/Main/AboutSettingsScreen';
import { AccountSettingsScreen } from '@/screens/Main/AccountSettingsScreen';
import { AppearanceSettingsScreen } from '@/screens/Main/AppearanceSettingsScreen';
import { BlockedUsersScreen } from '@/screens/Main/BlockedUsersScreen';
import { ContactSyncScreen } from '@/screens/Main/ContactSyncScreen';
import { ChatScreen } from '@/screens/Main/ChatScreen';
import { ConversationInfoScreen } from '@/screens/Main/ConversationInfoScreen';
import { ChatsSettingsScreen } from '@/screens/Main/ChatsSettingsScreen';
import { CallsSettingsScreen } from '@/screens/Main/CallsSettingsScreen';
import { CreateGroupScreen } from '@/screens/Main/CreateGroupScreen';
import { DevicesScreen } from '@/screens/Main/DevicesScreen';
import { EditProfileScreen } from '@/screens/Main/EditProfileScreen';
import { GroupChatScreen } from '@/screens/Main/GroupChatScreen';
import { GroupInfoScreen } from '@/screens/Main/GroupInfoScreen';
import { AddGroupMembersScreen } from '@/screens/Main/AddGroupMembersScreen';
import { ChatMediaPreviewScreen } from '@/screens/Main/ChatMediaPreviewScreen';
import { GroupQrScreen } from '@/screens/Main/GroupQrScreen';
import { GroupsListScreen } from '@/screens/Main/GroupsListScreen';
import { HelpSettingsScreen } from '@/screens/Main/HelpSettingsScreen';
import { JoinPreviewScreen } from '@/screens/Main/JoinPreviewScreen';
import { LinkIdentifierScreen } from '@/screens/Main/LinkIdentifierScreen';
import { MediaViewerScreen } from '@/screens/Main/MediaViewerScreen';
import { NewConversationScreen } from '@/screens/Main/NewConversationScreen';
import { NotificationsSettingsScreen } from '@/screens/Main/NotificationsSettingsScreen';
import { PrivacySettingsScreen } from '@/screens/Main/PrivacySettingsScreen';
import { MyStatusScreen } from '@/screens/Main/MyStatusScreen';
import { ScannerScreen } from '@/screens/Main/ScannerScreen';
import { StorageSettingsScreen } from '@/screens/Main/StorageSettingsScreen';
import { MediaEditorScreen } from '@/screens/Main/MediaEditorScreen';
import { StoryComposerScreen } from '@/screens/Main/StoryComposerScreen';
import { StoryViewerScreen } from '@/screens/Main/StoryViewerScreen';
import { StoryViewersScreen } from '@/screens/Main/StoryViewersScreen';

import { TabNavigator } from './TabNavigator';
import type { MainStackParamList } from './types';

const Stack = createNativeStackNavigator<MainStackParamList>();

export const MainNavigator: React.FC = () => (
  <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
    <Stack.Screen name="Tabs" component={TabNavigator} />
    <Stack.Screen name="Chat" component={ChatScreen} />
    <Stack.Screen name="ConversationInfo" component={ConversationInfoScreen} />
    <Stack.Screen name="NewConversation" component={NewConversationScreen} />
    <Stack.Screen name="EditProfile" component={EditProfileScreen} />
    <Stack.Screen name="AccountSettings" component={AccountSettingsScreen} />
    <Stack.Screen name="LinkIdentifier" component={LinkIdentifierScreen} />
    <Stack.Screen name="Devices" component={DevicesScreen} />
    <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
    <Stack.Screen name="ContactSync" component={ContactSyncScreen} />
    <Stack.Screen name="PrivacySettings" component={PrivacySettingsScreen} />
    <Stack.Screen name="ChatsSettings" component={ChatsSettingsScreen} />
    <Stack.Screen name="CallsSettings" component={CallsSettingsScreen} />
    <Stack.Screen name="NotificationsSettings" component={NotificationsSettingsScreen} />
    <Stack.Screen name="AppearanceSettings" component={AppearanceSettingsScreen} />
    <Stack.Screen name="StorageSettings" component={StorageSettingsScreen} />
    <Stack.Screen name="HelpSettings" component={HelpSettingsScreen} />
    <Stack.Screen name="AboutSettings" component={AboutSettingsScreen} />
    <Stack.Screen
      name="StoryComposer"
      component={StoryComposerScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen
      name="MediaEditor"
      component={MediaEditorScreen}
      options={{ animation: 'fade' }}
    />
    <Stack.Screen
      name="ChatMediaPreview"
      component={ChatMediaPreviewScreen}
      options={{ animation: 'fade' }}
    />
    <Stack.Screen
      name="StoryViewer"
      component={StoryViewerScreen}
      options={{ animation: 'fade' }}
    />
    <Stack.Screen name="MyStatus" component={MyStatusScreen} />
    <Stack.Screen
      name="StoryViewers"
      component={StoryViewersScreen}
      options={{ animation: 'slide_from_bottom' }}
    />

    {/* Groupes & Chaînes */}
    <Stack.Screen name="GroupsList" component={GroupsListScreen} />
    <Stack.Screen
      name="CreateGroup"
      component={CreateGroupScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen name="GroupChat" component={GroupChatScreen} />
    <Stack.Screen name="GroupInfo" component={GroupInfoScreen} />
    <Stack.Screen name="AddGroupMembers" component={AddGroupMembersScreen} />
    <Stack.Screen name="GroupQr" component={GroupQrScreen} />
    <Stack.Screen
      name="Scanner"
      component={ScannerScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen
      name="JoinPreview"
      component={JoinPreviewScreen}
      options={{ animation: 'slide_from_bottom' }}
    />
    <Stack.Screen
      name="MediaViewer"
      component={MediaViewerScreen}
      options={{ animation: 'fade', presentation: 'transparentModal' }}
    />
  </Stack.Navigator>
);
