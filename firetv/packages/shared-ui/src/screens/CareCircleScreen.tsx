import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

/**
 * CareCircle on the TV - the "shared display" surface, as real React Native.
 *
 * An ambient home (big clock, date, household) over which care gaps arrive as
 * notification cards that slide in, the way a TV OS surfaces an alert - not a
 * dashboard. One screen, rendered natively on Fire TV / Android TV / Apple TV and
 * on web, all from this shared package.
 *
 * Sizing is derived from the live window width at render (1920 = design width), so
 * it scales on both native and web - unlike the sample's build-time pixel scaler,
 * which collapses to 0 on web where screen dimensions are unknown at module load.
 */

const STATE_URL = 'https://krqi2tpsif.us-east-1.awsapprunner.com/api/state';

interface Gap { spoken: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; obligationId?: string }

const ACCENT: Record<string, string> = {
  HIGH: colors.notification, MEDIUM: colors.warning, LOW: colors.success,
};

/** Drop the "- nobody has taken this yet" tail; the card already says it needs an owner. */
function headline(spoken: string): string {
  return spoken.replace(/\s-\s.*$/, '').trim() || spoken;
}

export default function CareCircleScreen() {
  const { width } = useWindowDimensions();
  const s = useMemo(() => (n: number) => (n * width) / 1920, [width]);
  const styles = useMemo(() => makeStyles(s), [s]);

  const [gaps, setGaps] = useState<Gap[]>([]);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [idx, setIdx] = useState(0);

  // Poll the live care state.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(STATE_URL);
        const data = await res.json();
        if (!alive) return;
        setOnline(true);
        setGaps(Array.isArray(data.gaps) ? data.gaps : []);
      } catch {
        if (alive) setOnline(false);
      }
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Live clock.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const current = gaps.length ? gaps[idx % gaps.length] : undefined;

  // Slide the notification in, dwell, slide out, then advance to the next gap.
  const anim = useRef(new Animated.Value(0)).current; // 0 = hidden (up), 1 = shown
  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    Animated.timing(anim, { toValue: 1, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    const out = setTimeout(() => {
      Animated.timing(anim, { toValue: 0, duration: 500, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(() => {
        if (!cancelled && gaps.length) setIdx((i) => (i + 1) % gaps.length);
      });
    }, 6500);
    return () => { cancelled = true; clearTimeout(out); };
  }, [idx, current?.obligationId, current?.spoken, gaps.length, anim]);

  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const accent = current ? ACCENT[current.severity] : colors.textTertiary;

  return (
    <View style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.clock}>{time}</Text>
        <Text style={styles.date}>{day}</Text>
        <View style={styles.household}>
          <View style={[styles.dot, { backgroundColor: online ? colors.success : colors.error }]} />
          <Text style={styles.householdText}>MARGARET'S CARE CIRCLE</Text>
        </View>
      </View>

      {current && (
        <Animated.View
          style={[
            styles.notif,
            {
              opacity: anim,
              transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [s(-140), 0] }) }],
            },
          ]}
        >
          <View style={[styles.icon, { backgroundColor: `${accent}22` }]}>
            <Text style={[styles.iconGlyph, { color: accent }]}>♥</Text>
          </View>
          <View style={styles.notifBody}>
            <View style={styles.notifMeta}>
              <Text style={styles.notifApp}>CARECIRCLE</Text>
              <View style={[styles.metaDot, { backgroundColor: accent }]} />
              <Text style={[styles.notifNeeds, { color: accent }]}>NEEDS AN OWNER</Text>
            </View>
            <Text style={styles.notifText} numberOfLines={2}>{headline(current.spoken)}</Text>
          </View>
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Say “I’ll take it”</Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function makeStyles(s: (n: number) => number) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: '#05070d' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    clock: { color: colors.text, fontSize: s(260), fontWeight: '600', letterSpacing: s(-4) },
    date: { color: colors.textSecondary, fontSize: s(52), fontWeight: '300', marginTop: s(4) },
    household: { flexDirection: 'row', alignItems: 'center', marginTop: s(48) },
    dot: { width: s(16), height: s(16), borderRadius: s(8), marginRight: s(14) },
    householdText: { color: colors.textTertiary, fontSize: s(24), letterSpacing: s(6) },

    notif: {
      position: 'absolute', top: s(70), alignSelf: 'center',
      width: s(1000), flexDirection: 'row', alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1,
      borderRadius: s(28), padding: s(24),
    },
    icon: { width: s(84), height: s(84), borderRadius: s(20), alignItems: 'center', justifyContent: 'center' },
    iconGlyph: { fontSize: s(44) },
    notifBody: { flex: 1, marginHorizontal: s(24) },
    notifMeta: { flexDirection: 'row', alignItems: 'center' },
    notifApp: { color: colors.textTertiary, fontSize: s(20), letterSpacing: s(3) },
    metaDot: { width: s(8), height: s(8), borderRadius: s(4), marginHorizontal: s(12) },
    notifNeeds: { fontSize: s(20), letterSpacing: s(2) },
    notifText: { color: colors.text, fontSize: s(38), fontWeight: '500', marginTop: s(6) },
    cta: { borderColor: 'rgba(255,255,255,0.2)', borderWidth: 1, borderRadius: s(100), paddingHorizontal: s(28), paddingVertical: s(14) },
    ctaText: { color: colors.textSecondary, fontSize: s(22) },
  });
}
