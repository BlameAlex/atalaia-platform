import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { clampBirth, fromIso, MESES, toIso, type Ymd } from './logic';

const ROW = 44;
const VISIBLE = 5; // odd: the middle row is the selection
const PAD = ROW * ((VISIBLE - 1) / 2);
const DEFAULT: Ymd = { y: 1950, m: 1, d: 1 };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

function Wheel(p: { label: string; items: string[]; index: number; onChange: (i: number) => void; flex: number }) {
  const ref = useRef<ScrollViewInstance>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(p);
  latest.current = p; // the settle timer fires after re-renders; read current props, not the captured ones
  const goto = (i: number, animated = true) => ref.current?.scrollTo({ y: i * ROW, animated });
  const pick = (i: number) => {
    const { items, index, onChange } = latest.current;
    const c = Math.min(Math.max(i, 0), items.length - 1);
    if (c !== index) onChange(c);
    goto(c);
  };
  // Outside changes (e.g. 31 → 30 when the month shortens) move the wheel too.
  useEffect(() => goto(p.index), [p.index, p.items.length]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // One settle path for iOS, Android and web: pick the row once scrolling (drag or momentum) has stopped.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => pick(Math.round(y / ROW)), 120);
  };

  return (
    <View style={{ flex: p.flex }}>
      <Text style={st.colLabel}>{p.label}</Text>
      <View
        style={st.wheel}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={p.label}
        accessibilityValue={{ text: p.items[p.index] }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => pick(p.index + (e.nativeEvent.actionName === 'increment' ? 1 : -1))}
      >
        <View style={st.band} pointerEvents="none" />
        <ScrollView
          ref={ref}
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
          snapToInterval={ROW}
          decelerationRate="fast"
          scrollEventThrottle={32}
          onScroll={onScroll}
          onContentSizeChange={() => goto(p.index, false)}
          contentContainerStyle={{ paddingVertical: PAD }}
        >
          {p.items.map((t, i) => (
            <Pressable key={t} style={st.row} onPress={() => pick(i)} importantForAccessibility="no">
              <Text style={i === p.index ? st.on : st.off}>{t}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

/** Birth date as three wheels (Día / Mes / Año). Always holds a valid date, emitted as YYYY-MM-DD. */
export function DateWheel({ value, onChange, today = new Date() }: { value: string; onChange: (iso: string) => void; today?: Date }) {
  const v = fromIso(value) ?? DEFAULT;
  // Two wheels can settle in the same tick, before the parent re-renders: merge into the newest value.
  const cur = useRef(v);
  cur.current = v;
  useEffect(() => {
    if (!fromIso(value)) onChange(toIso(DEFAULT));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Ymd>) => {
    cur.current = clampBirth({ ...cur.current, ...patch }, today);
    onChange(toIso(cur.current));
  };
  const maxD = clampBirth({ ...v, d: 31 }, today).d;
  const maxM = clampBirth({ ...v, m: 12, d: 1 }, today).m;
  const years = range(1900, today.getFullYear());

  return (
    <View style={st.wrap}>
      <Wheel label="Día" flex={1} items={range(1, maxD)} index={v.d - 1} onChange={(i) => set({ d: i + 1 })} />
      <Wheel label="Mes" flex={2} items={MESES.slice(0, maxM)} index={v.m - 1} onChange={(i) => set({ m: i + 1 })} />
      <Wheel label="Año" flex={1.4} items={years} index={v.y - 1900} onChange={(i) => set({ y: 1900 + i })} />
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 8 },
  colLabel: { fontSize: 14, color: '#333', textAlign: 'center', marginBottom: 4 },
  wheel: { height: ROW * VISIBLE, borderWidth: 1, borderColor: '#999', borderRadius: 8, overflow: 'hidden' },
  band: {
    position: 'absolute', left: 0, right: 0, top: PAD, height: ROW,
    backgroundColor: 'rgba(26, 86, 219, 0.08)', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#1a56db',
  },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  on: { fontSize: 19, fontWeight: '700', color: '#111' },
  off: { fontSize: 17, color: '#6b7280' },
});
