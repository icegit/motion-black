import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { SPORT_META, sportIcon, sportIconNode } from "./sportConfig";
import { areAllSportsActive, toggleAllSports, toggleSportSelection } from "./filterUtils.js";
import {
  BASEMAP_ATTRIBUTION,
  DEFAULT_MAP_STYLE,
  FALLBACK_BASEMAP_TILE_URL,
  MAP_STYLES,
  MOBILE_TILE_OPTIONS,
} from "./mapTiles.js";
import { formatActivityCount, popupMarkup } from "./mapUtils";
import { markerOffsetMap } from "./markerLayout.js";
import "./styles.css";

const DATA_URL = `${import.meta.env.BASE_URL}data/activity-groups.json`;

function svgIconMarkup(type) {
  const meta = SPORT_META[type] ?? SPORT_META.other;
  const nodes = sportIconNode(type)
    .map(([tag, attributes]) => {
      const renderedAttributes = Object.entries(attributes)
        .filter(([name]) => name !== "key")
        .map(([name, value]) => `${name}="${String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;")}"`)
        .join(" ");
      return `<${tag} ${renderedAttributes} />`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${meta.iconViewBox}" fill="${meta.iconFill}" stroke="${meta.iconStroke}" stroke-width="2.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${nodes}</svg>`;
}

function markerMarkup(group) {
  const meta = SPORT_META[group.type] ?? SPORT_META.other;
  const glyph = svgIconMarkup(group.type);

  return `
    <div class="sport-pin" style="--sport-color:${meta.color}">
      <span class="sport-pin__glyph">${glyph}</span>
      ${group.activityCount > 1 ? `<span class="sport-pin__count">${group.activityCount}</span>` : ""}
    </div>`;
}

function ActivityMap({ groups, activeSports, mapStyle }) {
  const elementRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(null);
  const mapStyleLayerRef = useRef(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    const map = L.map(elementRef.current, {
      center: [24, 9],
      zoom: 2,
      minZoom: 2,
      maxZoom: 18,
      zoomControl: false,
      worldCopyJump: true,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);
    map.createPane("basemap");
    map.getPane("basemap").style.zIndex = "200";
    map.createPane("mapstyle");
    map.getPane("mapstyle").style.zIndex = "210";

    L.tileLayer(FALLBACK_BASEMAP_TILE_URL, {
      ...MOBILE_TILE_OPTIONS,
      pane: "basemap",
      attribution: BASEMAP_ATTRIBUTION,
      maxNativeZoom: 19,
      maxZoom: 19,
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      mapStyleLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const style = MAP_STYLES[mapStyle] ?? MAP_STYLES[DEFAULT_MAP_STYLE];
    const layer = L.tileLayer(style.url, {
      ...MOBILE_TILE_OPTIONS,
      pane: "mapstyle",
      attribution: style.attribution,
      maxNativeZoom: style.maxNativeZoom,
      maxZoom: 18,
      opacity: style.opacity,
      ...(style.subdomains ? { subdomains: style.subdomains } : {}),
    }).addTo(map);
    mapStyleLayerRef.current = layer;

    return () => {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      if (mapStyleLayerRef.current === layer) mapStyleLayerRef.current = null;
    };
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = markersRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const visibleGroups = groups.filter((group) => activeSports.has(group.type));
    const markerOffsets = markerOffsetMap(visibleGroups);

    visibleGroups.forEach((group) => {
      const offset = markerOffsets.get(group.id) ?? { x: 0, y: 0 };
      const marker = L.marker([group.latitude, group.longitude], {
        keyboard: true,
        riseOnHover: true,
        riseOffset: 1000,
        zIndexOffset: offset.y,
        title: `${group.label}: ${formatActivityCount(group.activityCount)}`,
        alt: `${group.label} activity cluster`,
        icon: L.divIcon({
          className: "sport-marker",
          html: markerMarkup(group),
          iconSize: [42, 46],
          iconAnchor: [21 - offset.x, 41 - offset.y],
          popupAnchor: [offset.x, offset.y - 37],
        }),
      });
      marker.bindPopup(popupMarkup(group), {
        className: "activity-popup",
        maxWidth: 360,
        minWidth: 320,
      });
      marker.addTo(layer);
    });

    if (!fittedRef.current && groups.length) {
      const bounds = L.latLngBounds(groups.map((group) => [group.latitude, group.longitude]));
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.18), { maxZoom: 4 });
      fittedRef.current = true;
    }
  }, [groups, activeSports]);

  return <div ref={elementRef} className="map" aria-label="Motion Black activity map" />;
}

function Stat({ value, label }) {
  return (
    <div className="stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [activeSports, setActiveSports] = useState(new Set());
  const [panelOpen, setPanelOpen] = useState(false);
  const [mapStyle, setMapStyle] = useState(DEFAULT_MAP_STYLE);
  const [unlocatedOpen, setUnlocatedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(DATA_URL, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Activity data returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setActiveSports(new Set(payload.sportTotals.map((sport) => sport.type)));
      })
      .catch(() => {
        if (!cancelled) setError("The activity archive is temporarily unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const sportTotals = data?.sportTotals ?? [];
  const sportTypes = useMemo(() => sportTotals.map((sport) => sport.type), [sportTotals]);
  const unlocatedSportTotals = data?.unlocatedSportTotals ?? [];
  const groups = data?.groups ?? [];
  const activityTypeCount = useMemo(
    () => new Set(
      [...sportTotals, ...unlocatedSportTotals].map((sport) => sport.type),
    ).size,
    [sportTotals, unlocatedSportTotals],
  );
  const years = useMemo(() => {
    const values = new Set();
    groups.forEach((group) => Object.keys(group.years).forEach((year) => values.add(year)));
    return [...values].filter((year) => year !== "Unknown").sort((a, b) => b.localeCompare(a));
  }, [groups]);
  const updatedDate = data
    ? new Date(data.generatedAt).toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const allSportsActive = areAllSportsActive(activeSports, sportTypes);
  const selectedSport = activeSports.size === 1
    ? sportTotals.find((sport) => activeSports.has(sport.type))
    : null;
  const selectionSummary = allSportsActive
    ? "All shown"
    : activeSports.size === 0
      ? "None shown"
      : selectedSport
        ? `${selectedSport.label} shown`
        : `${activeSports.size} shown`;

  const toggleSport = (type) => {
    setActiveSports((current) => toggleSportSelection(current, type, sportTypes));
  };

  const toggleAll = () => {
    setActiveSports((current) => toggleAllSports(current, sportTypes));
  };

  return (
    <main>
      <ActivityMap groups={groups} activeSports={activeSports} mapStyle={mapStyle} />

      <section className={`explorer ${panelOpen ? "is-open" : "is-closed"}`} aria-label="Activity map controls">
        <button
          className="panel-toggle"
          type="button"
          onClick={() => setPanelOpen((open) => !open)}
          aria-expanded={panelOpen}
          aria-label={panelOpen ? "Collapse activity summary" : "Open activity summary"}
        >
          <span aria-hidden="true">{panelOpen ? "−" : "+"}</span>
        </button>

        <div className="explorer__content">
          <div className="brand-row">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
            <p>GARMIN ACTIVITY ARCHIVE</p>
          </div>
          <h1>Motion Black</h1>
          <p className="lede">A life in movement, mapped across the world.</p>

          {error ? <div className="notice notice--error">{error}</div> : null}
          {!data && !error ? <div className="notice"><span className="pulse" /> Loading activities…</div> : null}

          {data ? (
            <>
              <div className="stats" aria-label="Archive summary">
                <Stat value={data.mappedActivities.toLocaleString()} label="mapped" />
                <Stat value={activityTypeCount.toLocaleString()} label="types" />
                <Stat value={years.length.toLocaleString()} label="years" />
              </div>

              <div className="section-heading">
                <span>ACTIVITY TYPES</span>
                <div className="section-heading__actions">
                  <small aria-live="polite">{selectionSummary}</small>
                  <button type="button" onClick={toggleAll}>{allSportsActive ? "Hide all" : "Show all"}</button>
                </div>
              </div>

              <div className="sport-filters">
                {sportTotals.map((sport) => {
                  const meta = SPORT_META[sport.type] ?? SPORT_META.other;
                  const selected = activeSports.has(sport.type);
                  const SportIcon = sportIcon(sport.type);
                  const actionLabel = allSportsActive
                    ? `Show only ${sport.label}`
                    : selected
                      ? `Hide ${sport.label}`
                      : `Show ${sport.label}`;
                  return (
                    <button
                      type="button"
                      key={sport.type}
                      className={selected ? "sport-filter is-active" : "sport-filter"}
                      style={{ "--sport-color": meta.color }}
                      onClick={() => toggleSport(sport.type)}
                      aria-pressed={selected}
                      aria-label={actionLabel}
                      title={actionLabel}
                    >
                      <span className="sport-filter__icon" aria-hidden="true">
                        <SportIcon stroke={1.9} />
                      </span>
                      <span className="sport-filter__label">{sport.label}</span>
                      <strong>{sport.activityCount}</strong>
                    </button>
                  );
                })}
              </div>

              <div className="section-heading section-heading--map-style">
                <span>MAP STYLE</span>
              </div>
              <div className="map-style-options" role="group" aria-label="Map style">
                {Object.entries(MAP_STYLES).map(([styleKey, style]) => (
                  <button
                    type="button"
                    key={styleKey}
                    className={mapStyle === styleKey ? "map-style-button is-active" : "map-style-button"}
                    onClick={() => setMapStyle(styleKey)}
                    aria-pressed={mapStyle === styleKey}
                  >
                    {style.label}
                  </button>
                ))}
              </div>

              <div className="privacy-note">
                <span aria-hidden="true">◎</span>
                <p>
                  GPS-free activities inherit the nearest native GPS within ±{data.locationInferenceWindowDays ?? 5} days;
                  private rules or defaults are used next. Nearby matching activity types are combined within {data.clusterRadiusKm} km,
                  and every location is rounded for privacy.
                </p>
              </div>
              {unlocatedOpen && unlocatedSportTotals.length ? (
                <section className="unlocated-details" id="without-gps-details" aria-label="Activities without GPS">
                  <div className="section-heading section-heading--unlocated">
                    <span>WITHOUT GPS</span>
                    <strong>{data.unlocatedActivities}</strong>
                  </div>
                  <div className="unlocated-list">
                    {unlocatedSportTotals.map((sport) => {
                      const meta = SPORT_META[sport.type] ?? SPORT_META.other;
                      const SportIcon = sportIcon(sport.type);
                      return (
                        <div
                          className="unlocated-item"
                          key={sport.type}
                          style={{ "--sport-color": meta.color }}
                          title="Add a private location rule to place these activities on the map"
                        >
                          <span className="sport-filter__icon" aria-hidden="true">
                            <SportIcon stroke={1.9} />
                          </span>
                          <span>{sport.label}</span>
                          <strong>{sport.activityCount}</strong>
                        </div>
                      );
                    })}
                  </div>
                  <p className="unlocated-help">
                    No native GPS was found within ±{data.locationInferenceWindowDays ?? 5} days. Assign an approximate place by activity type,
                    date range, or Garmin activity ID to map these safely.
                  </p>
                </section>
              ) : null}
              <footer className="archive-footer">
                <span className="live-dot" aria-hidden="true" />
                <span>
                  Updated {updatedDate}
                  {data.inferredLocationActivities ? ` · ${data.inferredLocationActivities} placed from nearby GPS` : ""}
                  {data.manuallyLocatedActivities ? ` · ${data.manuallyLocatedActivities} manually placed` : ""}
                  {data.customActivities ? ` · ${data.customActivities} custom` : ""}
                  {data.unlocatedActivities ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        className="archive-footer__button"
                        onClick={() => setUnlocatedOpen((open) => !open)}
                        aria-expanded={unlocatedOpen}
                        aria-controls="without-gps-details"
                      >
                        {data.unlocatedActivities} without GPS
                      </button>
                    </>
                  ) : null}
                </span>
              </footer>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
