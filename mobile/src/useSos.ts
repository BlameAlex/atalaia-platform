import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import * as Crypto from 'expo-crypto';
import { ApiError, getCurrentSos, sendDemoSos, sendSos, type Incident, type SosBody } from './api';
import { deletePending, deleteToken, getPending, setPending, type PendingSos } from './store';
import { backoffMs, DEMO, isClosed, isRetryable, shouldClearPending, type Phase } from './logic';

async function getFix(): Promise<SosBody> {
  try {
    const perm = await Location.getForegroundPermissionsAsync();
    if (!perm.granted) return {};
    let pos = await Location.getLastKnownPositionAsync({ maxAge: 60_000, requiredAccuracy: 100 });
    if (!pos) {
      pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((r) => setTimeout(() => r(null), 8000)),
      ]);
    }
    const acc = pos?.coords.accuracy;
    if (!pos || acc == null || acc > 100) return {};
    const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
    return { lat: r6(pos.coords.latitude), lng: r6(pos.coords.longitude), accuracyM: Math.ceil(acc) };
  } catch {
    return {};
  }
}

export function useSos() {
  const router = useRouter();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [note, setNote] = useState<string | null>(null);
  const [acked, setAcked] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const busy = useRef(false);
  const wake = useRef<(() => void) | null>(null);

  const signOutLocal = useCallback(async () => {
    await deleteToken();
    router.replace('/sign-in');
  }, [router]);

  const poll = useCallback(async () => {
    try {
      const { incident: cur } = await getCurrentSos();
      setIncident(cur);
      const p = await getPending();
      if (p && shouldClearPending(p.incidentId, cur)) { await deletePending(); setAcked(false); }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) await signOutLocal();
      // else: keep last known state, retry next tick
    }
  }, [signOutLocal]);

  // Assumes the caller set busy.current = true.
  const sendLoop = useCallback(async () => {
    try {
      let p = await getPending();
      if (!p || p.incidentId) return;
      if (!p.body) {
        setPhase('fix');
        p = { ...p, body: await getFix() };
        await setPending(p);
      }
      for (let attempt = 0; ; attempt++) {
        if (AppState.currentState !== 'active') return; // resumed on 'active'
        setPhase(attempt === 0 ? 'sending' : 'retrying');
        try {
          const { incident: inc } = await sendSos(p.key, p.body ?? {});
          p = { ...p, incidentId: inc.id } as PendingSos;
          await setPending(p);
          setIncident(inc);
          setPhase('idle');
          if (isClosed(inc.status)) { await deletePending(); setAcked(false); } else setAcked(true);
          return;
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          if (status === 401) { setPhase('auth'); return; }
          if (status === 403 && e instanceof ApiError && e.error === 'no_user') { setPhase('idle'); router.replace('/onboarding'); return; }
          if (!isRetryable(status)) {
            await deletePending(); // permanent rejection: let the user tap again
            setPhase('idle');
            setNote(e instanceof Error ? e.message : 'Error');
            return;
          }
          setPhase('retrying');
          await new Promise<void>((res) => {
            const t = setTimeout(res, backoffMs(attempt));
            wake.current = () => { clearTimeout(t); res(); };
          });
          wake.current = null;
        }
      }
    } finally {
      busy.current = false;
    }
  }, [router]);

  const resume = useCallback(() => {
    if (wake.current) { wake.current(); return; }
    if (busy.current) return;
    busy.current = true;
    void sendLoop();
  }, [sendLoop]);

  // Demo: every press is a new SOS that the server files for a random simulated user at a random point.
  // One key per press: retries reuse it (no duplicates), the next press gets a new one. Button never locks.
  const demoTap = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; // synchronous: swallows duplicate taps of the same press
    setNote(null);
    setAcked(false);
    const key = Crypto.randomUUID();
    let next: Phase = 'idle';
    try {
      for (let attempt = 0; ; attempt++) {
        setPhase(attempt === 0 ? 'sending' : 'retrying');
        try {
          await sendDemoSos(key);
          setAcked(true);
          return;
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0;
          if (status === 401) { next = 'auth'; return; }
          if (!isRetryable(status)) { setNote(e instanceof Error ? e.message : 'Error'); return; }
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        }
      }
    } finally {
      setPhase(next);
      busy.current = false;
    }
  }, []);

  const onTap = useCallback(async () => {
    if (DEMO) return demoTap();
    const open = incident && !isClosed(incident.status);
    if (busy.current || open || phase !== 'idle') return;
    busy.current = true; // synchronous: swallows taps 2..n
    setNote(null);
    const p = await getPending();
    if (!p) await setPending({ key: Crypto.randomUUID(), createdAt: new Date().toISOString(), body: null, incidentId: null });
    void sendLoop();
  }, [incident, phase, sendLoop, demoTap]);

  // startup
  useEffect(() => {
    if (DEMO) return; // demo presses don't use pendingSos or /sos/current
    void (async () => {
      try { await Location.requestForegroundPermissionsAsync(); } catch {}
      const p = await getPending();
      if (p && !p.incidentId) resume();
      else { setAcked(!!p?.incidentId); await poll(); }
    })();
  }, [poll, resume]);

  // foreground tracking: retry immediately on 'active'
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      setActive(s === 'active');
      if (s === 'active' && !DEMO) void getPending().then((p) => { if (p && !p.incidentId) resume(); });
    });
    return () => sub.remove();
  }, [resume]);

  const open = !!incident && !isClosed(incident.status);
  useEffect(() => {
    if (DEMO || !active || !(open || acked)) return;
    const t = setInterval(() => void poll(), 5000);
    return () => clearInterval(t);
  }, [active, open, acked, poll]);

  // Production: one open SOS locks the button; its lifecycle status is never shown in the app.
  return { locked: !DEMO && open, sent: acked, phase, note, onTap, signOutLocal };
}
