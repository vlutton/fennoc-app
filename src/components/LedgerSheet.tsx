import { Mic, X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import {
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { useTheme } from "../theme/useTheme";
import { LedgerBriefingsSection } from "./LedgerBriefingsSection";
import { LedgerSearchResults } from "./LedgerSearchResults";
import { LedgerTasksSection } from "./LedgerTasksSection";
import { LedgerTimeSection } from "./LedgerTimeSection";

interface LedgerSheetProps {
  visible: boolean;
  onClose: () => void;
}

type SectionId = "tasks" | "time" | "briefings";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "tasks", label: "Tasks" },
  { id: "time", label: "Time" },
  { id: "briefings", label: "Briefings" },
];

// The "Rule — summoned sheet height" battletest amendment (design_handoff's
// README) supersedes the same doc's earlier "68px of dimmed thread visible"
// line — that number covered only the status bar plus a small scrim margin
// and, taken literally, has the sheet rise over the app bar and status
// strip, which is exactly the defect the battletest amendment exists to
// fix ("must never cover the app bar or the persistent chrome directly
// beneath it"). This implements the amendment, not the superseded figure.
//
// Chrome preserved above the sheet: the safe-area top inset (status bar —
// read live below, not hardcoded 44) + ThreadScreen's 64px app bar + its
// 1px bottom border + the 28px status strip + its 1px bottom border. There
// is no chip shelf yet (INT-025) — when it ships, add its 56px + border
// here too, to reach the design's "both" row (600 at the 390×844
// reference). Today only "status strip only" (706) applies, and the
// formula below reproduces that number exactly given a 44px inset.
const APP_BAR_HEIGHT = 64;
const APP_BAR_BORDER = 1;
const STATUS_STRIP_HEIGHT = 28;
const STATUS_STRIP_BORDER = 1;

const LIFT_EASING = Easing.bezier(0.16, 1, 0.3, 1);
const QUIET_EASING = Easing.bezier(0.2, 0, 0, 1);
const SCRIM_OPACITY = 0.62;
const RISE_MS = 320;
const SCRIM_IN_MS = 200;
const DISMISS_MS = 220;

/**
 * The Ledger — INT-024. Hand-rolled on `react-native-reanimated` + RN
 * `Modal` (no `@gorhom/bottom-sheet`: it pulls in `react-native-gesture-
 * handler`, which INT-014c deliberately avoided). Rises over the thread,
 * never over the app bar/status strip beneath it (see the height rule
 * comment above `APP_BAR_HEIGHT`), and never swaps the thread out for a
 * new screen — closing just lets the animation run in reverse.
 *
 * Search, the Tasks filter, and which section is "active" are all local
 * state that lives in this subtree. The subtree unmounts on close (the
 * `if (!modalVisible) return null` below) and remounts fresh on the next
 * open, which is what actually satisfies "filter persistence: none" — there
 * is no stale state to explicitly clear, because there is no state left to
 * find.
 */
export function LedgerSheet({ visible, onClose }: LedgerSheetProps) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const [modalVisible, setModalVisible] = useState(visible);
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<SectionId>("tasks");

  const translateY = useSharedValue(windowHeight);
  const scrimOpacity = useSharedValue(0);

  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SectionId, number>>>({});

  useEffect(() => {
    if (visible) {
      setModalVisible(true);
      translateY.value = withTiming(0, { duration: RISE_MS, easing: LIFT_EASING });
      scrimOpacity.value = withTiming(SCRIM_OPACITY, { duration: SCRIM_IN_MS, easing: Easing.linear });
    } else {
      translateY.value = withTiming(windowHeight, { duration: DISMISS_MS, easing: QUIET_EASING }, (finished) => {
        if (finished) runOnJS(setModalVisible)(false);
      });
      scrimOpacity.value = withTiming(0, { duration: DISMISS_MS, easing: QUIET_EASING });
    }
  }, [visible, windowHeight, translateY, scrimOpacity]);

  // Reset search/section/offsets at the moment of opening, in addition to
  // the unmount-on-close above — belt and suspenders against the search bar
  // ever showing a leftover query for one frame before the subtree remounts.
  useEffect(() => {
    if (visible) {
      setQuery("");
      setActiveSection("tasks");
      sectionOffsets.current = {};
    }
  }, [visible]);

  const sheetHeight =
    windowHeight - insets.top - APP_BAR_HEIGHT - APP_BAR_BORDER - STATUS_STRIP_HEIGHT - STATUS_STRIP_BORDER;

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  if (!modalVisible) return null;

  const onSectionLayout = (id: SectionId) => (event: { nativeEvent: { layout: { y: number } } }) => {
    sectionOffsets.current[id] = event.nativeEvent.layout.y;
  };

  const onPressSection = (id: SectionId) => {
    setActiveSection(id);
    const y = sectionOffsets.current[id];
    if (y !== undefined) scrollRef.current?.scrollTo({ y, animated: true });
  };

  // Lightweight scrollspy: the pills are anchors into one document, not
  // tabs, so "selected" should track what's actually on screen as the user
  // free-scrolls, not just the last pill they tapped.
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = event.nativeEvent.contentOffset.y;
    let current: SectionId = "tasks";
    for (const section of SECTIONS) {
      const offset = sectionOffsets.current[section.id];
      if (offset !== undefined && offset <= y + 8) current = section.id;
    }
    setActiveSection(current);
  };

  const searching = query.trim().length > 0;

  return (
    <Modal animationType="none" onRequestClose={onClose} transparent visible={modalVisible}>
      <View className="flex-1">
        {/* Scrim. Its 62% dimming comes from the animated `opacity` style,
            not a color token, so this stays a plain `bg-bg-base` layer —
            no rgba()/hex literal needed to hit the design's "62% scrim". */}
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <Pressable
            accessibilityLabel="Close ledger"
            accessibilityRole="button"
            className="flex-1 bg-bg-base"
            onPress={onClose}
          />
        </Animated.View>

        {/* Animated.View only carries the transform — NativeWind's className
            doesn't resolve on react-native-reanimated's Animated.View
            without registering it via cssInterop, so all the visual
            styling (radius/border/bg/maxHeight) lives on the plain View
            nested inside it instead. */}
        <Animated.View style={[styles.sheetPositioner, sheetStyle]}>
          {/*
            `height`, not `maxHeight`. maxHeight only caps — it does not size —
            so the sheet collapsed to its header and the flex-1 ScrollView below
            got zero height, rendering no sections at all despite live data.

            The ledger is deliberately the FULL-height sheet: the design has it
            rise leaving 68px of dimmed thread visible, so its height is the
            computed frame-minus-chrome value rather than its content. Summoned
            widget sheets (INT-025) are the ones that size to content and merely
            cap at this value.
          */}
          <View
            className="rounded-t-sheet border-t border-line-strong bg-bg-overlay"
            style={{ height: sheetHeight }}
          >
            <View className="mt-3 h-1 w-9 self-center rounded-[2px] bg-line-strong" />

            <View className="flex-row items-center justify-between px-4 pb-3 pt-3">
              <Text className="font-sans-semibold text-title text-ink">Ledger</Text>
              <Pressable
                accessibilityLabel="Close"
                accessibilityRole="button"
                className="h-touch w-touch items-center justify-center"
                onPress={onClose}
              >
                <X color={palette.ink.DEFAULT} size={22} />
              </Pressable>
            </View>

            <View className="px-4 pb-3">
              <View className="h-12 flex-row items-center gap-2 rounded-sm border border-line-hairline bg-bg-raised px-3">
                <TextInput
                  accessibilityLabel="Search the ledger"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="flex-1 font-sans text-body text-ink"
                  onChangeText={setQuery}
                  placeholder="Find anything"
                  placeholderTextColor={palette.ink.muted}
                  value={query}
                />
                <Pressable
                  accessibilityLabel="Search by voice"
                  accessibilityRole="button"
                  className="h-9 w-9 items-center justify-center rounded-full border border-line-strong active:opacity-80"
                  // Visual size is 36×36 per spec; hitSlop brings the real
                  // touch target to 48×48 without changing how it looks —
                  // same fix StatusStrip already uses for its budget marks.
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  onPress={() => {
                    // TODO(INT-025): voice capture (listening/thinking/
                    // transcription) isn't built yet — see CaptureBar's
                    // identical no-op mic path. Inert, not a fake "listening"
                    // state with no transcription behind it.
                  }}
                >
                  <Mic color={palette.ink.muted} size={16} />
                </Pressable>
              </View>
            </View>

            {!searching ? (
              <View className="flex-row gap-2 px-4 pb-3">
                {SECTIONS.map((section) => {
                  const active = activeSection === section.id;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      className={`h-touch items-center justify-center rounded-full border px-5 ${
                        active ? "border-ink bg-ink" : "border-line-strong bg-transparent"
                      }`}
                      key={section.id}
                      onPress={() => onPressSection(section.id)}
                    >
                      <Text className={`font-sans-medium text-label ${active ? "text-bg-base" : "text-ink"}`}>
                        {section.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <ScrollView
              className="flex-1 min-h-0"
              contentContainerClassName="px-4 pb-8"
              onScroll={searching ? undefined : onScroll}
              ref={scrollRef}
              scrollEventThrottle={100}
            >
              {searching ? (
                <LedgerSearchResults query={query} />
              ) : (
                <>
                  <View className="mb-6" onLayout={onSectionLayout("tasks")}>
                    <LedgerTasksSection />
                  </View>
                  <View className="mb-6" onLayout={onSectionLayout("time")}>
                    <LedgerTimeSection />
                  </View>
                  <View onLayout={onSectionLayout("briefings")}>
                    <LedgerBriefingsSection />
                  </View>
                </>
              )}
            </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetPositioner: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
