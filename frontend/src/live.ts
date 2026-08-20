// Empfängt den Fortschritt einer Routenberechnung und führt ihn zu Zustand
// zusammen. Ohne React, damit die Logik testbar bleibt.
import type { LngLat, RouteResult } from "./types";

export interface LiveWaypoint {
  lng: number;
  lat: number;
  label: string;
}

export type LiveEvent =
  | { type: "start"; waypoints: LiveWaypoint[]; roundTrip: boolean; segments: number }
  | {
      type: "leg";
      index: number;
      coordinates: LngLat[];
      distanceM: number;
      durationS: number;
    }
  | { type: "done"; route: unknown }
  | { type: "error"; message: string };

export interface LiveState {
  /** Läuft gerade eine Berechnung? */
  active: boolean;
  waypoints: LiveWaypoint[];
  roundTrip: boolean;
  segments: number;
  /** Bisher gezeichnete Linie. */
  line: LngLat[];
  legsDone: number;
  distanceM: number;
  durationS: number;
  /** Fertiges Ergebnis, sobald es vorliegt. */
  done: RouteResult | null;
  error: string | null;
}

export function emptyLiveState(): LiveState {
  return {
    active: false,
    waypoints: [],
    roundTrip: false,
    segments: 0,
    line: [],
    legsDone: 0,
    distanceM: 0,
    durationS: 0,
    done: null,
    error: null,
  };
}

export function applyLiveEvent(state: LiveState, event: LiveEvent): LiveState {
  switch (event.type) {
    case "start":
      // Eine neue Planung verwirft den Fortschritt der alten.
      return {
        ...emptyLiveState(),
        active: true,
        waypoints: event.waypoints,
        roundTrip: event.roundTrip,
        segments: event.segments,
      };

    case "leg":
      // Abschnitte ohne vorheriges start gehören zu einer Planung, die wir
      // nicht gesehen haben: nichts zeichnen.
      if (!state.active) return state;
      return {
        ...state,
        line: [...state.line, ...event.coordinates],
        legsDone: state.legsDone + 1,
        distanceM: state.distanceM + event.distanceM,
        durationS: state.durationS + event.durationS,
      };

    case "done":
      return { ...state, active: false, done: event.route as RouteResult };

    case "error":
      return { ...state, active: false, error: event.message };
  }
}

/** Hört den SSE-Kanal ab. Die Rückgabe beendet das Abhören. */
export function subscribeLive(onEvent: (event: LiveEvent) => void): () => void {
  const source = new EventSource("/api/live");
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as LiveEvent);
    } catch {
      // Unlesbares Ereignis überspringen, die Verbindung bleibt bestehen.
    }
  };
  // EventSource verbindet nach einem Fehler von selbst neu; nichts zu tun.
  return () => source.close();
}
