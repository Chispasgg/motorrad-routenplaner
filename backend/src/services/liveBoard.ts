// Verteilt den Fortschritt einer Routenberechnung an die Weboberfläche.
// Eine einzige, globale Tafel: es gibt genau einen Nutzer und keine Sitzungen.
import type { LiveEvent } from "../types.js";

/** Obergrenze der gemerkten Folge. Schützt vor unbegrenztem Wachstum. */
const MAX_SEQUENCE = 200;

export interface LiveBoard {
  publish(event: LiveEvent): void;
  /** Meldet einen Zuhörer an und gibt die Abmeldung zurück. */
  subscribe(send: (event: LiveEvent) => void): () => void;
  /** Die Folge der letzten Planung, für später hinzukommende Zuhörer. */
  snapshot(): LiveEvent[];
  subscriberCount(): number;
}

export function createLiveBoard(): LiveBoard {
  const listeners = new Set<(event: LiveEvent) => void>();
  let sequence: LiveEvent[] = [];

  return {
    publish(event) {
      // Ein neues start beginnt eine neue Planung: alte Folge verwerfen.
      if (event.type === "start") sequence = [event];
      else if (sequence.length < MAX_SEQUENCE) sequence.push(event);

      for (const send of listeners) {
        try {
          send(event);
        } catch {
          // Ein hängender Zuhörer darf die übrigen nicht blockieren.
        }
      }
    },

    subscribe(send) {
      listeners.add(send);
      return () => {
        listeners.delete(send);
      };
    },

    snapshot() {
      return sequence;
    },

    subscriberCount() {
      return listeners.size;
    },
  };
}

export const liveBoard = createLiveBoard();
