// Schlägt einen Namen für eine zu speichernde Route vor. Reine Logik, damit sie
// ohne React testbar bleibt.

/** Grenze des Namensfeldes im Backend. */
const NAME_MAX = 120;

/** Nimmt den ersten Teil vor dem Komma: "Bilbao, Bizkaia, ..." -> "Bilbao". */
function shortLabel(label: string): string {
  return label.split(",")[0]?.trim() ?? "";
}

export function suggestRouteName(labels: string[], roundTrip: boolean): string {
  const short = labels.map(shortLabel).filter((l) => l !== "");
  if (short.length < 2) return "Route";

  const start = short[0];
  const end = short[short.length - 1];
  const between = short.length - 2;

  let name = roundTrip ? `Rundtour ${start}` : `${start} → ${end}`;
  if (!roundTrip && between > 0) {
    name += ` (${between} ${between === 1 ? "Zwischenziel" : "Zwischenziele"})`;
  }
  return name.length > NAME_MAX ? name.slice(0, NAME_MAX - 1).trimEnd() + "…" : name;
}
