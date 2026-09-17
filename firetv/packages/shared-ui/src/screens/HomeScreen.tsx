// CareCircle - the CareBoard. The fourth surface in "four surfaces, one system":
// the ambient care board on the living-room TV. Renders the SAME live MCP state
// the web console reads (today's Care Gaps, who owns what, proposed obligations)
// at 10-foot / glanceable scale, with the CONFIRMED / INFERRED / NO RECORD
// provenance chip on every card. D-pad focusable. No new backend - polls /api/state.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { useNavigation, DrawerActions, useIsFocused } from '@react-navigation/native';
import {
  SpatialNavigationRoot,
  SpatialNavigationScrollView,
  SpatialNavigationNode,
  SpatialNavigationFocusableView,
  DefaultFocus,
} from 'react-tv-space-navigation';
import { Direction } from '@bam.tech/lrud';
import { scaledPixels } from '../hooks/useScale';
import { colors, safeZones } from '../theme';
import { useMenuContext } from '../components/MenuContext';
import { getOpenDrawerDirection } from '../utils/rtl';
import {
  fetchCareState,
  CareState,
  Gap,
  Obligation,
  CHIP_META,
  ChipKey,
  provKey,
  gapChip,
} from '../data/careState';

const POLL_MS = 4000;

const severityColor = (sev?: string): string => {
  const s = (sev ?? '').toLowerCase();
  if (s === 'high' || s === 'urgent' || s === 'critical') return colors.error;
  if (s === 'med' || s === 'medium' || s === 'moderate') return colors.warning;
  return colors.info;
};

function Chip({ chip }: { chip: ChipKey }) {
  const m = CHIP_META[chip];
  return (
    <View style={[styles.chip, { backgroundColor: m.bg }]}>
      <View style={[styles.chipDot, { backgroundColor: m.color }]} />
      <Text style={[styles.chipText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

function Card({
  accent,
  children,
}: {
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <SpatialNavigationFocusableView>
      {({ isFocused }: { isFocused: boolean }) => (
        <View
          style={[
            styles.card,
            { borderLeftColor: accent },
            isFocused && styles.cardFocused,
          ]}
        >
          {children}
        </View>
      )}
    </SpatialNavigationFocusableView>
  );
}

function GapCard({ gap, chip }: { gap: Gap; chip: ChipKey }) {
  return (
    <Card accent={severityColor(gap.severity)}>
      <View style={styles.cardTop}>
        <Text style={styles.cardWhat} numberOfLines={2}>
          {gap.spoken}
        </Text>
        <View style={[styles.pill, { borderColor: severityColor(gap.severity) }]}>
          <Text style={[styles.pillText, { color: severityColor(gap.severity) }]}>
            {gap.kind}
          </Text>
        </View>
      </View>
      {!!gap.because && (
        <Text style={styles.cardWhy} numberOfLines={2}>
          {gap.because}
        </Text>
      )}
      <Chip chip={chip} />
    </Card>
  );
}

function OwnedCard({ ob }: { ob: Obligation }) {
  return (
    <Card accent={colors.success}>
      <Text style={styles.cardWhat} numberOfLines={2}>
        {ob.what}
      </Text>
      <Text style={styles.owner}>
        <Text style={styles.ownerName}>{ob.owner ?? 'someone'}</Text> has this.
      </Text>
      <Chip chip={provKey(ob.provenance)} />
    </Card>
  );
}

function ProposalCard({ ob }: { ob: Obligation }) {
  return (
    <Card accent={CHIP_META.inferred.color}>
      <Text style={styles.cardWhat} numberOfLines={2}>
        {ob.what}
      </Text>
      <Text style={styles.owner}>Proposed - waiting for someone to confirm.</Text>
      <Chip chip="inferred" />
    </Card>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionCount}>{count}</Text>
      </View>
      <View style={styles.cardColumn}>{children}</View>
    </View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation();
  const { isOpen: isMenuOpen, toggleMenu } = useMenuContext();
  const isFocused = useIsFocused();
  const isActive = isFocused && !isMenuOpen;

  const [state, setState] = useState<CareState | null>(null);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await fetchCareState();
        if (!alive) return;
        setState(s);
        setError(false);
        setUpdatedAt(new Date());
      } catch {
        if (alive) setError(true);
      }
    };
    load();
    timer.current = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const onDirectionHandledWithoutMovement = useCallback(
    (movement: Direction) => {
      if (movement === getOpenDrawerDirection()) {
        navigation.dispatch(DrawerActions.openDrawer());
        toggleMenu(true);
      }
    },
    [navigation, toggleMenu],
  );

  const gaps = state?.gaps ?? [];
  const obligations = state?.obligations ?? [];
  const obById: Record<string, Obligation> = Object.fromEntries(
    obligations.map((o) => [o.id, o]),
  );
  const owned = obligations.filter((o) => o.status === 'ASSIGNED');
  const proposals = obligations.filter((o) => o.status === 'PROPOSED');
  const nothingOutstanding =
    !!state && gaps.length === 0 && proposals.length === 0;

  return (
    <SpatialNavigationRoot
      isActive={isActive}
      onDirectionHandledWithoutMovement={onDirectionHandledWithoutMovement}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>CareCircle</Text>
            <Text style={styles.household}>
              {state?.household?.name ?? 'Care circle'}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.liveRow}>
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: error ? colors.error : colors.success },
                ]}
              />
              <Text style={styles.liveText}>
                {error ? 'reconnecting' : 'live'}
              </Text>
            </View>
            {!!updatedAt && (
              <Text style={styles.updatedText}>
                updated{' '}
                {updatedAt.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            )}
          </View>
        </View>

        {!state && !error && (
          <View style={styles.centerBox}>
            <Text style={styles.centerText}>Loading the care board…</Text>
          </View>
        )}

        {error && !state && (
          <View style={styles.centerBox}>
            <Text style={styles.centerText}>
              Care board unavailable - is the MCP server running?
            </Text>
          </View>
        )}

        {!!state && (
          <SpatialNavigationScrollView
            offsetFromStart={scaledPixels(60)}
            style={styles.scroll}
          >
            <DefaultFocus>
              <SpatialNavigationNode>
                <View style={styles.columns}>
                  <Section title="Care Gaps" count={gaps.length}>
                    {gaps.length === 0 ? (
                      <Text style={styles.emptyNote}>No open gaps right now.</Text>
                    ) : (
                      gaps.map((g, i) => (
                        <GapCard key={`gap-${i}`} gap={g} chip={gapChip(g, obById)} />
                      ))
                    )}
                  </Section>

                  <Section title="Owned" count={owned.length}>
                    {owned.length === 0 ? (
                      <Text style={styles.emptyNote}>Nothing assigned yet.</Text>
                    ) : (
                      owned.map((o) => <OwnedCard key={o.id} ob={o} />)
                    )}
                  </Section>

                  <Section title="Proposed" count={proposals.length}>
                    {proposals.length === 0 ? (
                      <Text style={styles.emptyNote}>No proposals waiting.</Text>
                    ) : (
                      proposals.map((o) => <ProposalCard key={o.id} ob={o} />)
                    )}
                  </Section>
                </View>
              </SpatialNavigationNode>
            </DefaultFocus>

            {nothingOutstanding && (
              <Text style={styles.allClear}>
                Nothing outstanding. Everything recorded has an owner.
              </Text>
            )}
          </SpatialNavigationScrollView>
        )}
      </View>
    </SpatialNavigationRoot>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: scaledPixels(safeZones.actionSafe.horizontal),
    paddingVertical: scaledPixels(safeZones.actionSafe.vertical),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: scaledPixels(28),
  },
  brand: {
    color: colors.primary,
    fontSize: scaledPixels(28),
    fontWeight: '700',
    letterSpacing: 2,
  },
  household: {
    color: colors.text,
    fontSize: scaledPixels(52),
    fontWeight: '800',
    marginTop: scaledPixels(4),
  },
  headerRight: { alignItems: 'flex-end' },
  liveRow: { flexDirection: 'row', alignItems: 'center' },
  liveDot: {
    width: scaledPixels(14),
    height: scaledPixels(14),
    borderRadius: scaledPixels(7),
    marginEnd: scaledPixels(10),
  },
  liveText: {
    color: colors.textSecondary,
    fontSize: scaledPixels(24),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  updatedText: {
    color: colors.textTertiary,
    fontSize: scaledPixels(20),
    marginTop: scaledPixels(6),
  },
  scroll: { flex: 1 },
  columns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  section: {
    width: '32%',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: scaledPixels(16),
  },
  sectionTitle: {
    color: colors.text,
    fontSize: scaledPixels(34),
    fontWeight: '700',
  },
  sectionCount: {
    color: colors.textOnPrimary,
    backgroundColor: colors.textTertiary,
    fontSize: scaledPixels(20),
    fontWeight: '700',
    minWidth: scaledPixels(34),
    textAlign: 'center',
    borderRadius: scaledPixels(17),
    paddingHorizontal: scaledPixels(10),
    paddingVertical: scaledPixels(2),
    marginStart: scaledPixels(12),
    overflow: 'hidden',
  },
  cardColumn: {},
  card: {
    backgroundColor: colors.card,
    borderRadius: scaledPixels(16),
    borderLeftWidth: scaledPixels(8),
    borderWidth: scaledPixels(2),
    borderColor: 'transparent',
    padding: scaledPixels(22),
    marginBottom: scaledPixels(18),
  },
  cardFocused: {
    borderColor: colors.focusBorder,
    backgroundColor: colors.cardElevated,
    transform: [{ scale: 1.03 }],
    shadowColor: colors.focus,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: scaledPixels(18),
    elevation: 12,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardWhat: {
    color: colors.text,
    fontSize: scaledPixels(30),
    fontWeight: '700',
    lineHeight: scaledPixels(38),
    flexShrink: 1,
  },
  cardWhy: {
    color: colors.textSecondary,
    fontSize: scaledPixels(23),
    lineHeight: scaledPixels(31),
    marginTop: scaledPixels(10),
  },
  owner: {
    color: colors.textSecondary,
    fontSize: scaledPixels(23),
    marginTop: scaledPixels(10),
  },
  ownerName: { color: colors.success, fontWeight: '700' },
  pill: {
    borderWidth: scaledPixels(2),
    borderRadius: scaledPixels(999),
    paddingHorizontal: scaledPixels(12),
    paddingVertical: scaledPixels(3),
    marginStart: scaledPixels(12),
  },
  pillText: {
    fontSize: scaledPixels(18),
    fontWeight: '700',
    letterSpacing: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: scaledPixels(999),
    paddingHorizontal: scaledPixels(14),
    paddingVertical: scaledPixels(6),
    marginTop: scaledPixels(16),
  },
  chipDot: {
    width: scaledPixels(12),
    height: scaledPixels(12),
    borderRadius: scaledPixels(6),
    marginEnd: scaledPixels(8),
  },
  chipText: {
    fontSize: scaledPixels(19),
    fontWeight: '800',
    letterSpacing: 1,
  },
  emptyNote: {
    color: colors.textTertiary,
    fontSize: scaledPixels(24),
    fontStyle: 'italic',
    paddingVertical: scaledPixels(8),
  },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  centerText: {
    color: colors.textSecondary,
    fontSize: scaledPixels(30),
  },
  allClear: {
    color: colors.success,
    fontSize: scaledPixels(26),
    textAlign: 'center',
    marginTop: scaledPixels(30),
  },
});
