// Prüft, dass die MCP-Typen mit denen des Backends kompatibel bleiben.
// Wird nur typgeprüft (tsconfig.contract.json, noEmit) und nie ausgeführt:
// eine inkompatible Änderung im Backend bricht damit den Build.
import type * as B from "../../backend/src/types.js";
import type * as M from "./../src/types.js";

// Zuweisbarkeit in beide Richtungen erzwingen.
const _lngLat: B.LngLat = [0, 0] as M.LngLat;
const _lngLatBack: M.LngLat = [0, 0] as B.LngLat;
const _profile: B.ProfileName = "curvy" as M.ProfileName;
const _profileBack: M.ProfileName = "curvy" as B.ProfileName;
const _nogo: B.NoGo = {} as M.NoGo;
const _nogoBack: M.NoGo = {} as B.NoGo;
const _leg: B.RouteLeg = {} as M.RouteLeg;
const _legBack: M.RouteLeg = {} as B.RouteLeg;
const _feat: B.RouteFeaturePoint = {} as M.RouteFeaturePoint;
const _featBack: M.RouteFeaturePoint = {} as B.RouteFeaturePoint;
// GeocodeResult, RouteResult und WeatherResult haben in backend/src/types.ts kein
// Gegenstück: das Backend beschreibt diese Formen in seinen Services. Sie werden
// deshalb hier nicht geprüft – die Abdeckung endet an dem, was das Backend exportiert.
const _poi: B.Poi = {} as M.Poi;
const _poiBack: M.Poi = {} as B.Poi;
const _rw: B.Roadwork = {} as M.Roadwork;
const _rwBack: M.Roadwork = {} as B.Roadwork;
const _wp: B.WeatherPoint = {} as M.WeatherPoint;
const _wpBack: M.WeatherPoint = {} as B.WeatherPoint;

// Verhindert "unused"-Fehler, ohne zur Laufzeit etwas zu tun.
export type ContractChecked = typeof _lngLat | typeof _lngLatBack | typeof _profile
  | typeof _profileBack | typeof _nogo | typeof _nogoBack | typeof _leg
  | typeof _legBack | typeof _feat | typeof _featBack
  | typeof _poi | typeof _poiBack | typeof _rw
  | typeof _rwBack | typeof _wp | typeof _wpBack;
