import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

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
import { useTheme } from "../theme/useTheme";

type ConnectionState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; status: Status }
  | { kind: "error"; message: string };

const THEME_OPTIONS: ThemePreference[] = ["night", "day", "system"];

export function SettingsScreen() {
  const { palette } = useTheme();
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
          result.token.length > 20
            ? `${result.token.slice(0, 20)}…`
            : result.token;
        setDevNotifStatus(`Registered: ${shown}`);
        break;
      }
      case "skipped-not-a-device":
        setDevNotifStatus(`Skipped — ${result.reason}`);
        break;
      case "skipped-no-permission":
        setDevNotifStatus(
          'Skipped — permission not granted yet. Tap "Enable notifications" first.',
        );
        break;
      case "failed":
        setDevNotifStatus(`Registration failed: ${result.reason}`);
        break;
    }
  }, []);

  return (
    // A plain View, not a `SafeAreaView edges={["top"]}`. This screen has not
    // been the top edge since it stopped being a tab-bar route: App.tsx
    // presents it in a Modal underneath its own header bar, and that bar is
    // what sits against the status bar now and claims the inset. Claiming it
    // here too put a status-bar-height gap in the middle of the screen.
    <View className="flex-1 bg-bg-raised">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pb-8 pt-4"
        keyboardShouldPersistTaps="handled"
      >
        {/* No "Settings" heading here — App.tsx's modal header bar already
            says it, directly above. This screen carried its own title from
            its tab-bar days, and while the two were different sizes it read
            as a heading over a section; on the real type scale they are the
            same 20px semibold and it just looks like the word printed
            twice. */}
        <Text className="font-sans text-body text-clay">
          Connect this phone to your Fennoc API over Tailscale.
        </Text>

        <FieldLabel label="Tailscale URL" />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-touch rounded-lg border border-bg-base bg-bg-overlay px-3 font-sans text-body text-ink"
          onChangeText={setUrlDraft}
          placeholder="https://host.tailnet.ts.net:8643"
          placeholderTextColor={palette.ink.muted}
          value={urlDraft}
        />

        <FieldLabel label="API key" />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-touch rounded-lg border border-bg-base bg-bg-overlay px-3 font-sans text-body text-ink"
          onChangeText={setApiKeyDraft}
          placeholder={keyLoaded ? "Bearer token" : "Loading…"}
          placeholderTextColor={palette.ink.muted}
          secureTextEntry
          value={apiKeyDraft}
        />

        <FieldLabel label="User ID" />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-touch rounded-lg border border-bg-base bg-bg-overlay px-3 font-sans text-body text-ink"
          onChangeText={setUserDraft}
          placeholder="vince"
          placeholderTextColor={palette.ink.muted}
          value={userDraft}
        />

        <Pressable
          accessibilityRole="button"
          className="mt-6 min-h-touch items-center justify-center rounded-lg bg-clay px-4 active:opacity-80"
          disabled={connection.kind === "loading"}
          onPress={onTestConnection}
        >
          {connection.kind === "loading" ? (
            <ActivityIndicator color={palette.bg.raised} />
          ) : (
            <Text className="font-sans-semibold text-label text-bg-raised">
              Test Connection
            </Text>
          )}
        </Pressable>

        {/* selectable throughout — this is the connection DIAGNOSTIC block,
            and the "ok"/"error" cases are exactly the kind of text an
            operator would want to copy out (a status summary, or a real
            connection failure). None of these Text nodes sit inside a
            Pressable. */}
        <View className="mt-4 rounded-xl bg-bg-base p-4">
          {connection.kind === "idle" && (
            <Text className="font-sans text-body text-ink" selectable>
              Not tested yet.
            </Text>
          )}
          {connection.kind === "loading" && (
            <Text className="font-sans text-body text-ink" selectable>
              Checking…
            </Text>
          )}
          {connection.kind === "ok" && (
            <Text className="font-sans text-body text-ink" selectable>
              ✅ Connected — open {connection.status.open} / completed{" "}
              {connection.status.completed} / overdue{" "}
              {connection.status.overdue}
            </Text>
          )}
          {connection.kind === "error" && (
            <Text className="font-sans text-body text-ink" selectable>
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
                className={`min-h-touch min-w-12 flex-1 items-center justify-center rounded-lg px-3 ${
                  active ? "bg-ink" : "bg-bg-base"
                }`}
                onPress={() => setTheme(option)}
              >
                <Text
                  className={`font-sans-medium text-label capitalize ${
                    active ? "text-bg-raised" : "text-ink"
                  }`}
                >
                  {option}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/*
          Not gated on `__DEV__`. It was, and that made this section invisible
          in exactly the builds it is needed in: `__DEV__` is false in any
          release build, which includes the internal `preview` APKs used for
          on-device testing. The result was an app where notification
          permission could not be granted at all — this is the only call site
          for it — and so a push token could never be acquired either, since
          registration is deliberately gated on permission already being
          granted.

          This app ships to one person through internal distribution and is on
          no store, so an always-visible testing panel costs nothing. Gate it
          again only once there is a real onboarding path for permission, and
          not on `__DEV__`, which does not mean "internal build".
        */}
        <View className="mt-8 rounded-xl border border-bg-base bg-bg-raised p-4">
          <Text className="font-sans-semibold text-body text-ink">
            Notifications (testing)
          </Text>
          <Text className="mt-1 font-sans text-caption text-ink-secondary">
            Grant permission, then register this device so Fennoc can reach it.
            The per-channel buttons fire local test pings to check importance,
            sound, and action set.
          </Text>

          <Pressable
            accessibilityRole="button"
            className="mt-4 min-h-touch items-center justify-center rounded-lg bg-signal px-4 active:opacity-80"
            onPress={onRequestDevPermission}
          >
            <Text className="font-sans-semibold text-label text-signal-on">
              Enable notifications
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            className="mt-3 min-h-touch items-center justify-center rounded-lg bg-signal px-4 active:opacity-80"
            onPress={onRegisterDevice}
          >
            <Text className="font-sans-semibold text-label text-signal-on">
              Register this device
            </Text>
          </Pressable>

          <View className="mt-3 flex-row flex-wrap gap-2">
            {CHANNEL_IDS.map((channelId) => (
              <Pressable
                key={channelId}
                accessibilityRole="button"
                className="min-h-touch min-w-24 flex-1 items-center justify-center rounded-lg bg-ink px-3 active:opacity-80"
                onPress={onFireDevNotification(channelId)}
              >
                <Text className="font-sans-medium text-label capitalize text-bg-raised">
                  {channelId}
                </Text>
              </Pressable>
            ))}
          </View>

          {devNotifStatus ? (
            // Another diagnostic-text surface (permission/registration
            // results, including failure reasons) — same rationale as the
            // connection block above.
            <Text className="mt-3 font-sans text-caption text-ink" selectable>
              {devNotifStatus}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return (
    <Text className="mb-2 mt-5 font-sans-medium text-label text-ink">
      {label}
    </Text>
  );
}
