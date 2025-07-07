import React, { useEffect, useState, useRef, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Circle,
  Rectangle,
  GeoJSON,
  Pane,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import polyline from "@mapbox/polyline";
import "leaflet/dist/leaflet.css";

// Full-viewport CSS
document.head.insertAdjacentHTML(
  "beforeend",
  `<style>html, body { margin: 0; padding: 0; height: 100%; } #root { height: 100%; }</style>`
);

// Fix marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require("leaflet/dist/images/marker-icon-2x.png"),
  iconUrl: require("leaflet/dist/images/marker-icon.png"),
  shadowUrl: require("leaflet/dist/images/marker-shadow.png"),
});

// Strava OAuth
const CLIENT_ID = "167098";
const CLIENT_SECRET = "c7c9681e877fb1894bd63ddfc8c42e902755150c";
const REDIRECT_URI = "https://t8d2vp.csb.app";

// Activity colors
const getColor = (type) => {
  switch (type) {
    case "Hike":
      return "#000000";
    case "Walk":
      return "#E64F51";
    case "Run":
      return "#328EB9";
    case "Ride":
      return "#FE9900";
    default:
      return "#EC8CDD";
  }
};

// Degree ≈ 1 km
const KM_IN_DEG_LAT = 1 / 110.574;
const KM_IN_DEG_LNG = (lat) => 1 / (111.32 * Math.cos((lat * Math.PI) / 180));

// Tile helpers
function getTileKey(lat, lng) {
  const x = Math.floor(lng / KM_IN_DEG_LNG(lat));
  const y = Math.floor(lat / KM_IN_DEG_LAT);
  return `${x},${y}`;
}
function getTileBounds(key) {
  const [x, y] = key.split(",").map(Number);
  const lat = y * KM_IN_DEG_LAT;
  const lng = x * KM_IN_DEG_LNG(lat);
  return [
    [lat, lng],
    [lat + KM_IN_DEG_LAT, lng + KM_IN_DEG_LNG(lat + KM_IN_DEG_LAT)],
  ];
}
function getPolylineTiles(coords) {
  const s = new Set();
  coords.forEach(([lat, lng]) => s.add(getTileKey(lat, lng)));
  return s;
}
function findSquareCluster(conquered) {
  const pts = Array.from(conquered).map((k) => k.split(",").map(Number));
  let best = { size: 0, origin: null };
  const has = (x, y) => conquered.has(`${x},${y}`);
  pts.forEach(([x, y]) => {
    let maxLen = 0;
    // try growing square
    while (
      [...Array(maxLen + 1).keys()].every(
        (i) => has(x + i, y + maxLen) && has(x + maxLen, y + i)
      )
    ) {
      maxLen++;
    }
    if (maxLen > best.size) best = { size: maxLen, origin: [x, y] };
  });
  const square = new Set();
  if (best.origin) {
    const [ox, oy] = best.origin;
    for (let dx = 0; dx < best.size; dx++)
      for (let dy = 0; dy < best.size; dy++)
        square.add(`${ox + dx},${oy + dy}`);
  }
  return square;
}
function useVisibleTiles() {
  const map = useMap();
  const [bounds, setBounds] = useState(map.getBounds());
  useMapEvents({
    moveend: () => setBounds(map.getBounds()),
    zoomend: () => setBounds(map.getBounds()),
  });
  useEffect(() => setBounds(map.getBounds()), [map]);
  if (!bounds) return { minX: 0, maxX: -1, minY: 0, maxY: -1 };
  const sw = bounds.getSouthWest(),
    ne = bounds.getNorthEast();
  const minY = Math.floor(sw.lat / KM_IN_DEG_LAT),
    maxY = Math.ceil(ne.lat / KM_IN_DEG_LAT);
  const centerLat = (sw.lat + ne.lat) / 2;
  const lngDeg = KM_IN_DEG_LNG(centerLat);
  const minX = Math.floor(sw.lng / lngDeg),
    maxX = Math.ceil(ne.lng / lngDeg);
  return { minX, maxX, minY, maxY };
}

function ExplorerTiles({ routes, visible }) {
  const conquered = useMemo(() => {
    const s = new Set();
    routes.forEach((r) => getPolylineTiles(r.coords).forEach((k) => s.add(k)));
    return s;
  }, [routes]);
  const square = useMemo(() => findSquareCluster(conquered), [conquered]);
  const { minX, maxX, minY, maxY } = useVisibleTiles();
  if (!visible) return null;
  return (
    <>
      {Array.from(conquered).map((key) => {
        const [x, y] = key.split(",").map(Number);
        if (x < minX || x > maxX || y < minY || y > maxY) return null;
        const isSq = square.has(key);
        return (
          <Rectangle
            key={key}
            bounds={getTileBounds(key)}
            pathOptions={{
              color: isSq ? "#328EB9" : "#E64F51",
              fillColor: isSq ? "rgba(50,142,185,0.4)" : "rgba(230,79,81,0.3)",
              weight: 1,
              fillOpacity: 1,
            }}
          />
        );
      })}
    </>
  );
}

export default function App() {
  const [accessToken, setAccessToken] = useState(null);
  const [routes, setRoutes] = useState([]);
  const [showStats, setShowStats] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tilesOn, setTilesOn] = useState(false);
  const [bordersOpen, setBordersOpen] = useState(false);
  const [bordersOption, setBordersOption] = useState("None");
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("All");
  const [userLoc, setUserLoc] = useState(null);
  const [counties, setCounties] = useState(null);

  const exchanged = useRef(false);
  const mapRef = useRef(null);
  const CENTER = [51.505, -0.09],
    ZOOM = 12;
  const font = "system-ui, sans-serif",
    fsz = 13;
  const btn = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: font,
    fontSize: fsz,
    fontWeight: "bold",
    background: "white",
    border: "1px solid #ccc",
    borderRadius: 8,
    cursor: "pointer",
    width: 30,
    height: 30,
    padding: 0,
  };

  const filterOptions = [
    { label: "🥾 Hiking", type: "Hike" },
    { label: "👟 Walking", type: "Walk" },
    { label: "🏃 Running", type: "Run" },
    { label: "🚴 Cycling", type: "Ride" },
    { label: "🏅 All Activities", type: "All" },
    { label: "🚫 No Activities", type: "None" },
  ];

  const filteredRoutes = useMemo(() => {
    if (selectedType === "All") return routes;
    if (selectedType === "None") return [];
    return routes.filter((r) => r.type === selectedType);
  }, [routes, selectedType]);

  // Load counties GeoJSON
  useEffect(() => {
    fetch(
      "https://raw.githubusercontent.com/evansd/uk-ceremonial-counties/master/uk-ceremonial-counties.geojson"
    )
      .then((r) => r.json())
      .then(setCounties)
      .catch(console.error);
  }, []);

  // Strava OAuth
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (code && !exchanged.current) {
      exchanged.current = true;
      (async () => {
        const res = await fetch("https://www.strava.com/oauth/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            grant_type: "authorization_code",
          }),
        });
        const d = await res.json();
        if (res.ok) setAccessToken(d.access_token);
      })();
    }
  }, []);

  // Fetch activities
  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      let page = 1,
        all = [];
      while (1) {
        const res = await fetch(
          `https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const d = await res.json();
        if (!res.ok || d.length === 0) break;
        d.forEach((act) => {
          if (act.map?.summary_polyline) {
            const coords = polyline
              .decode(act.map.summary_polyline)
              .map(([la, lo]) => [la, lo]);
            all.push({ coords, type: act.sport_type });
          }
        });
        page++;
      }
      setRoutes(all);
    })();
  }, [accessToken]);

  if (showStats) {
    return (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          background: "#fff",
          fontFamily: font,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 20,
            left: 20,
            zIndex: 1000,
            ...btn,
            padding: "0 10px",
          }}
        >
          Statistics
        </div>
        <div
          style={{
            position: "absolute",
            top: 20,
            right: 20,
            zIndex: 1000,
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <div onClick={() => setMenuOpen((o) => !o)} style={btn}>
            ☰
          </div>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 6,
                background: "#fff",
                border: "1px solid #ccc",
                borderRadius: 8,
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                padding: 6,
                minWidth: 100,
              }}
            >
              <div
                onClick={() => {
                  setShowStats(false);
                  setMenuOpen(false);
                  mapRef.current?.setView(CENTER, ZOOM);
                }}
                style={{
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: fsz,
                }}
              >
                Heatmap
              </div>
              <div
                onClick={() => setMenuOpen(false)}
                style={{
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: fsz,
                }}
              >
                Statistics
              </div>
              <div
                onClick={() => {
                  setAccessToken(null);
                  setRoutes([]);
                  window.location.href = window.location.pathname;
                }}
                style={{
                  padding: "4px 8px",
                  cursor: "pointer",
                  fontSize: fsz,
                }}
              >
                Logout
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        fontFamily: font,
      }}
    >
      <style>
        {`.leaflet-top.leaflet-left .leaflet-control-zoom{top:70px!important;left:20px!important;}`}
      </style>

      {/* Top-left: Title & 📍 */}
      <div
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          zIndex: 1000,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        <div style={{ ...btn, width: "auto", padding: "0 10px" }}>
          Traxplore
        </div>
        <button
          onClick={() => {
            if (!navigator.geolocation)
              return alert("Geolocation not supported");
            navigator.geolocation.getCurrentPosition(
              ({ coords }) => {
                const latlng = [coords.latitude, coords.longitude];
                setUserLoc(latlng);
                mapRef.current?.setView(latlng, ZOOM);
              },
              () => alert("Unable to retrieve your location")
            );
          }}
          style={btn}
        >
          📍
        </button>
      </div>

      {/* The map */}
      <MapContainer
        center={CENTER}
        zoom={ZOOM}
        style={{ width: "100%", height: "100%" }}
        whenCreated={(map) => (mapRef.current = map)}
      >
        <Pane name="bordersPane" style={{ zIndex: 650 }} />
        <TileLayer
          url="https://api.maptiler.com/maps/basic-v2/{z}/{x}/{y}.png?key=lABo0Xq95K1kxNYiJGpi"
          attribution="© MapTiler © OpenStreetMap contributors"
        />
        {/* Borders */}
        {bordersOption === "UK" && counties && (
          <GeoJSON
            pane="bordersPane"
            data={counties}
            style={{ color: "#555", weight: 2, fillOpacity: 0 }}
          />
        )}
        {/* Tiles */}
        {tilesOn && <ExplorerTiles routes={filteredRoutes} visible={tilesOn} />}
        {/* Strava polylines */}
        {filteredRoutes.map((r, i) => (
          <Polyline
            key={i}
            positions={r.coords}
            pathOptions={{ color: getColor(r.type), weight: 3, opacity: 0.8 }}
          />
        ))}
        {/* User location */}
        {userLoc && (
          <Circle
            center={userLoc}
            radius={30}
            pathOptions={{
              color: "#3388ff",
              fillColor: "#3388ff",
              fillOpacity: 0.4,
            }}
          />
        )}
      </MapContainer>

      {/* Top-right controls */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 1000,
          display: "flex",
          gap: 6,
          alignItems: "center",
        }}
      >
        {!accessToken ? (
          <a
            href={`https://www.strava.com/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
              REDIRECT_URI
            )}&response_type=code&scope=activity:read_all`}
            style={{
              ...btn,
              width: "auto",
              padding: "0 10px",
              textDecoration: "none",
            }}
          >
            Connect with Strava
          </a>
        ) : (
          <>
            {/* 1) Tiles toggle */}
            <div onClick={() => setTilesOn((o) => !o)} style={btn}>
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: tilesOn ? "#FE9900" : "transparent",
                  border: "2px solid #FE9900",
                }}
              />
            </div>

            {/* 2) Borders dropdown */}
            <div style={{ position: "relative" }}>
              <div onClick={() => setBordersOpen((o) => !o)} style={btn}>
                <span role="img" aria-label="borders" style={{ fontSize: 18 }}>
                  🚩
                </span>
              </div>
              {bordersOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 6,
                    background: "#fff",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    padding: 6,
                    minWidth: 140,
                  }}
                >
                  <div
                    onClick={() => {
                      setBordersOption("UK");
                      setBordersOpen(false);
                    }}
                    style={{
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: fsz,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <img
                      src="https://upload.wikimedia.org/wikipedia/en/a/ae/Flag_of_the_United_Kingdom.svg"
                      alt="UK"
                      style={{ width: 18, height: 12 }}
                    />
                    UK Counties
                  </div>
                  <div
                    onClick={() => {
                      setBordersOption("None");
                      setBordersOpen(false);
                    }}
                    style={{
                      padding: "4px 8px",
                      cursor: "pointer",
                      fontSize: fsz,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span role="img" aria-label="no" style={{ fontSize: 18 }}>
                      🚫
                    </span>
                    No Borders
                  </div>
                </div>
              )}
            </div>

            {/* 3) Activity filter */}
            <div style={{ position: "relative" }}>
              <div onClick={() => setFilterOpen((o) => !o)} style={btn}>
                <span style={{ fontSize: 18 }}>⚡</span>
              </div>
              {filterOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    right: 0,
                    marginTop: 6,
                    background: "#fff",
                    border: "1px solid #ccc",
                    borderRadius: 8,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                    padding: 6,
                    minWidth: 140,
                  }}
                >
                  {filterOptions.map((opt) => (
                    <div
                      key={opt.type}
                      onClick={() => {
                        setSelectedType(opt.type);
                        setFilterOpen(false);
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "4px 8px",
                        cursor: "pointer",
                        fontSize: fsz,
                        background:
                          selectedType === opt.type
                            ? getColor(opt.type)
                            : "transparent",
                        color: selectedType === opt.type ? "#fff" : "#000",
                        borderRadius: 4,
                      }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 4) Main menu */}
            <div onClick={() => setMenuOpen((o) => !o)} style={btn}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <div style={{ width: 16, height: 2, background: "#000" }} />
                <div style={{ width: 16, height: 2, background: "#000" }} />
                <div style={{ width: 16, height: 2, background: "#000" }} />
              </div>
            </div>
            {menuOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: 6,
                  background: "#fff",
                  border: "1px solid #ccc",
                  borderRadius: 8,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                  padding: 6,
                }}
              >
                <div
                  onClick={() => {
                    setShowStats(true);
                    setMenuOpen(false);
                  }}
                  style={{
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: fsz,
                  }}
                >
                  Statistics
                </div>
                <div
                  onClick={() => {
                    setAccessToken(null);
                    setRoutes([]);
                    window.location.href = window.location.pathname;
                  }}
                  style={{
                    padding: "4px 8px",
                    cursor: "pointer",
                    fontSize: fsz,
                  }}
                >
                  Logout
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
