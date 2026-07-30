import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { formatApiError, getStatus, resetClient } from "../api/client";
import type { Status } from "../api/types";
import {
  CHANNEL_IDS,
  registerPushTokenAsync,
  requestNotificationPermissionAsync,
  triggerDevNotificationAsync,
  type ChannelId,
} from "../notifications";
import {
  getKey,
  setKey,
  useAuth,
  type ThemePreference,
} from "../store/useAuth";
import { colors, nightPalette } from "../theme/colors";

type ConnectionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; status: Status }
  | { kind: "error"; message: string };

const THEME_OPTIONS: ThemePreference[] = ["night", "day", "system"];

export function SettingsScreen() {
  const baseUrl = useAuth((s) => s.baseUrl);
  const userId = useAuth((s) => s.userId);
  const theme = useAuth((s) => s.theme);
  const setBaseUrl = useAuth((s) => s.setBaseUrl);
  const setUserId = useAuth((s) => s.setUserId);
  const setTheme = useAuth((s) => s.setTheme);

  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [userDraft, setUserDraft] = useState(userId);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>({
    kind: "idle",
  });
  const [devNotifStatus, setDevNotifStatus] = useState<string | null>(null);

  useEffect(() => {
    setUrlDraft(baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    setUserDraft(userId);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await getKey();
      if (!cancelled) {
        setApiKeyDraft(stored ?? "");
        setKeyLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistFields = useCallback(async () => {
    const nextUrl = urlDraft.trim() || baseUrl;
    const nextUser = userDraft.trim() || "vince";
    setBaseUrl(nextUrl);
    setUserId(nextUser);
    await setKey(apiKeyDraft.trim());
    resetClient();
    return { nextUrl, nextUser };
  }, [apiKeyDraft, baseUrl, setBaseUrl, setUserId, urlDraft, userDraft]);

  const onTestConnection = useCallback(async () => {
    setConnection({ kind: "loading" });
    try {
      await persistFields();
      const status = await getStatus();
      setConnection({ kind: "ok", status });
    } catch (error) {
      setConnection({ kind: "error", message: formatApiError(error) });
    }
  }, [persistFields]);

  // Dev-only (INT-020 verification). Not a production permission-request
  // moment — see src/notifications/permissions.ts for why this must never
  // be the real call site.
  const onRequestDevPermission = useCallback(async () => {
    try {
      const granted = await requestNotificationPermissionAsync();
      setDevNotifStatus(
        granted
          ? "Permission granted."
          : "Permission denied — enable it in system settings to see test notifications.",
      );
    } catch (error) {
      setDevNotifStatus(`Permission request failed: ${formatApiError(error)}`);
    }
  }, []);

  const onFireDevNotification = useCallback((channelId: ChannelId) => {
    return async () => {
      try {
        await triggerDevNotificationAsync(channelId);
        setDevNotifStatus(`Fired "${channelId}" — check the shade in ~1s.`);
      } catch (error) {
        setDevNotifStatus(`"${channelId}" failed: ${formatApiError(error)}`);
      }
    };
  }, []);

  // Dev-only verification for the push-registration path. Not a
  // production call site — registerPushTokenAsync() is also invoked
  // automatically (and silently) from initNotifications() once permission
  // is already granted; this button exists so a dev can trigger it
  // on-demand and see the outcome, e.g. right after granting permission
  // above without waiting for the next cold start.
  const onRegisterDevice = useCallback(async () => {
    setDevNotifStatus("Registering…");
    const result = await registerPushTokenAsync();
    switch (result.status) {
      case "registered": {
        // The token is a credential — anyone holding it can push to this
        // device — so only a truncated prefix is shown, enough to eyeball
        // against the `device_tokens` row on the server without splashing
        // the whole thing on screen.
        const shown =
          result.token.length > 20 ? `${result.token.slice(0, 20)}…` : result.token;
        setDevNotifStatus(`Registered: ${shown}`);
        break;
      }
      case "skipped-not-a-device":
        setDevNotifStatus(`Skipped — ${result.reason}`);
        break;
      case "skipped-no-permission":
        setDevNotifStatus(
          "Skipped — permission not granted yet. Tap \"Enable notifications\" first.",
        );
        break;
      case "failed":
        setDevNotifStatus(`Registration failed: ${result.reason}`);
        break;
    }
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-base font-semibold leading-6 text-olive">
          Settings
        </Text>
        <Text className="mt-1 text-base leading-6 text-terracotta">
          Connect this phone to your Fennoc API over Tailscale.
        </Text>

        <FieldLabel label="Tailscale URL" />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-12 rounded-lg border border-sand bg-white px-3 text-base leading-6 text-olive"
          onChangeText={setUrlDraft}
          placeholder="https://host.tailnet.ts.net:8643"
          placeholderTextColor={nightPalette.ink.muted}
          value={urlDraft}
        />

        <FieldLabel label="API key" />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-12 rounded-lg border border-sand bg-white px-3 text-base leading-6 text-olive"
          onChangeText={setApiKeyDraft}
          placeholder={keyLoaded ? "Bearer token" : "Loading…"}
          placeholderTextColor={nightPalette.ink.muted}
          secureTextEntry
          value={apiKeyDraft}
        />

        <FieldLabel label="User ID" />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-12 rounded-lg border border-sand bg-white px-3 text-base leading-6 text-olive"
          onChangeText={setUserDraft}
          placeholder="vince"
          placeholderTextColor={nightPalette.ink.muted}
          value={userDraft}
        />

        <Pressable
          accessibilityRole="button"
          className="mt-6 min-h-12 items-center justify-center rounded-lg bg-terracotta px-4 active:opacity-80"
          disabled={connection.kind === "loading"}
          onPress={onTestConnection}
        >
          {connection.kind === "loading" ? (
            <ActivityIndicator color={colors.cream} />
          ) : (
            <Text className="text-base font-semibold leading-6 text-cream">
              Test Connection
            </Text>
          )}
        </Pressable>

        <View className="mt-4 rounded-xl bg-sand p-4">
          {connection.kind === "idle" && (
            <Text className="text-base leading-6 text-olive">
              Not tested yet.
            </Text>
          )}
          {connection.kind === "loading" && (
            <Text className="text-base leading-6 text-olive">
              Checking…
            </Text>
          )}
          {connection.kind === "ok" && (
            <Text className="text-base leading-6 text-olive">
              ✅ Connected — open {connection.status.open} / completed{" "}
              {connection.status.completed} / overdue{" "}
              {connection.status.overdue}
            </Text>
          )}
          {connection.kind === "error" && (
            <Text className="text-base leading-6 text-olive">
              ❌ Failed: {connection.message}
            </Text>
          )}
        </View>

        <FieldLabel label="Theme" />
        <View className="flex-row gap-2">
          {THEME_OPTIONS.map((option) => {
            const active = theme === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="button"
                className={`min-h-12 min-w-12 flex-1 items-center justify-center rounded-lg px-3 ${
                  active ? "bg-olive" : "bg-sand"
                }`}
                onPress={() => setTheme(option)}
              >
                <Text
                  className={`text-base font-medium capitalize leading-6 ${
                    active ? "text-cream" : "text-olive"
                  }`}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {__DEV__ ? (
          <View className="mt-8 rounded-xl border border-sand bg-cream p-4">
            <Text className="text-base font-semibold leading-6 text-olive">
              Dev: notifications (INT-020)
            </Text>
            <Text className="mt-1 text-sm leading-5 text-olive opacity-70">
              Local test pings only — no remote transport is wired up yet.
              Grant permission once, then fire each channel to check its
              importance, sound, and action set.
            </Text>

            <Pressable
              accessibilityRole="button"
              className="mt-4 min-h-12 items-center justify-center rounded-lg bg-signal px-4 active:opacity-80"
              onPress={onRequestDevPermission}
            >
              <Text className="text-base font-semibold leading-6 text-signal-on">
                Enable notifications
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              className="mt-3 min-h-12 items-center justify-center rounded-lg bg-signal px-4 active:opacity-80"
              onPress={onRegisterDevice}
            >
              <Text className="text-base font-semibold leading-6 text-signal-on">
                Register this device
              </Text>
            </Pressable>

            <View className="mt-3 flex-row flex-wrap gap-2">
              {CHANNEL_IDS.map((channelId) => (
                <Pressable
                  key={channelId}
                  accessibilityRole="button"
                  className="min-h-12 min-w-24 flex-1 items-center justify-center rounded-lg bg-olive px-3 active:opacity-80"
                  onPress={onFireDevNotification(channelId)}
                >
                  <Text className="text-base font-medium capitalize leading-6 text-cream">
                    {channelId}
                  </Text>
                </Pressable>
              ))}
            </View>

            {devNotifStatus ? (
              <Text className="mt-3 text-sm leading-5 text-olive">
                {devNotifStatus}
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <Text className="mb-2 mt-5 text-base font-medium leading-6 text-olive">
      {label}
    </Text>
  );
}
