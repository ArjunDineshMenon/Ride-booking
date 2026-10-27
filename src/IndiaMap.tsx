import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Crosshair,
  Globe2,
  LoaderCircle,
  MapPin,
  Minus,
  Navigation,
  Plus,
} from "lucide-react";
import { api, type Place, type RoadRoute } from "./api";

const INDIA_BOUNDS: L.LatLngBoundsExpression = [
  [6.4, 68],
  [37.5, 97.5],
];
type Props = {
  pickup?: Place;
  dropoff?: Place;
  active: boolean;
  route?: RoadRoute;
  mode: "pickup" | "dropoff";
  onMode: (mode: "pickup" | "dropoff") => void;
  onSelect: (place: Place, mode: "pickup" | "dropoff") => void;
  onError: (message: string) => void;
};

export default function IndiaMap(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [selecting, setSelecting] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const sequence = useRef(0);
  const select = async (lat: number, lng: number, mode: Props["mode"]) => {
    if (latest.current.active) return;
    const id = ++sequence.current;
    setSelecting(true);
    try {
      const p = await api<Place>("/locations", "POST", { lat, lng });
      if (id === sequence.current) latest.current.onSelect(p, mode);
    } catch (e) {
      if (id === sequence.current) latest.current.onError((e as Error).message);
    } finally {
      if (id === sequence.current) setSelecting(false);
    }
  };
  const selectRef = useRef(select);
  selectRef.current = select;
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      zoomControl: false,
      minZoom: 4,
      maxZoom: 19,
      maxBounds: [
        [2, 60],
        [42, 106],
      ],
      maxBoundsViscosity: 0.7,
    });
    map.current = instance;
    instance.fitBounds(INDIA_BOUNDS, { padding: [10, 10] });
    let disposed = false;
    api<{ tile_url: string; tile_attribution: string }>("/config")
      .then((config) => {
        if (disposed) return;
        let failures = 0;
        L.tileLayer(config.tile_url, {
          attribution: config.tile_attribution,
          maxZoom: 19,
          keepBuffer: 2,
        })
          .on("tileerror", () => {
            if (++failures > 2) setTilesFailed(true);
          })
          .on("tileload", () => {
            failures = 0;
            setTilesFailed(false);
          })
          .addTo(instance);
      })
      .catch(() => setTilesFailed(true));
    markers.current = L.layerGroup().addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (!latest.current.active)
        void selectRef.current(
          event.latlng.lat,
          event.latlng.lng,
          latest.current.mode,
        );
    });
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current);
    return () => {
      disposed = true;
      sequence.current++;
      resize.disconnect();
      instance.remove();
      map.current = null;
      markers.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = map.current,
      layer = markers.current;
    if (!instance || !layer) return;
    layer.clearLayers();
    const points: L.LatLngExpression[] = [];
    for (const [p, mode] of [
      [props.pickup, "pickup"],
      [props.dropoff, "dropoff"],
    ] as const) {
      if (!p) continue;
      const position: L.LatLngExpression = [p.lat, p.lng];
      points.push(position);
      const icon = L.divIcon({
        className: "roam-map-marker",
        html: `<span class="pin-${mode}">${mode === "pickup" ? "P" : "D"}</span>`,
        iconSize: [30, 38],
        iconAnchor: [15, 38],
      });
      const marker = L.marker(position, {
        icon,
        draggable: !props.active,
        title: `${mode === "pickup" ? "Pickup" : "Destination"}: ${p.name}`,
        alt: `${mode} marker`,
      }).addTo(layer);
      const tooltip = document.createElement("span");
      tooltip.textContent = p.name;
      marker.bindTooltip(tooltip, { direction: "top", offset: [0, -34] });
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        marker.setLatLng(position);
        void selectRef.current(pos.lat, pos.lng, mode);
      });
    }
    if (props.route?.geometry.length) {
      const coordinates = props.route.geometry.map(
        ([lng, lat]) => [lat, lng] as L.LatLngTuple,
      );
      L.polyline(coordinates, {
        color: "white",
        weight: 8,
        opacity: 0.9,
      }).addTo(layer);
      L.polyline(coordinates, {
        color: "#ed4267",
        weight: 4,
        dashArray: props.route.source === "estimate" ? "7 9" : undefined,
      }).addTo(layer);
    }
    if (points.length > 1)
      instance.fitBounds(L.latLngBounds(points), {
        paddingTopLeft: [50, 90],
        paddingBottomRight: [50, 130],
        maxZoom: 14,
      });
  }, [props.pickup?.id, props.dropoff?.id, props.route, props.active]);
  const locate = () => {
    if (!navigator.geolocation) {
      props.onError(
        "Location is not supported by this browser. Select a pickup on the map.",
      );
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        void selectRef.current(
          position.coords.latitude,
          position.coords.longitude,
          "pickup",
        );
      },
      () => {
        setLocating(false);
        props.onError(
          "Could not access your location. You can choose any pickup on the map.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <div className="city-map real-map">
      <div
        ref={container}
        className="leaflet-map"
        aria-label="Interactive map of India. Choose pickup or destination, then click the map."
      />
      <div className="real-map-toolbar">
        <div className="map-mode-control">
          <button
            className={props.mode === "pickup" ? "selected" : ""}
            onClick={() => props.onMode("pickup")}
            disabled={props.active}
          >
            <span className="location-dot" />
            Pickup
          </button>
          <button
            className={props.mode === "dropoff" ? "selected" : ""}
            onClick={() => props.onMode("dropoff")}
            disabled={props.active}
          >
            <span className="location-dot destination" />
            Destination
          </button>
        </div>
        <button
          className="india-button"
          onClick={() =>
            map.current?.fitBounds(INDIA_BOUNDS, { padding: [20, 20] })
          }
        >
          <Globe2 size={14} />
          All India
        </button>
      </div>
      <div className="map-controls">
        <button
          title="Zoom in"
          aria-label="Zoom in"
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={18} />
        </button>
        <button
          title="Zoom out"
          aria-label="Zoom out"
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={18} />
        </button>
        <span />
        <button
          title="Fit route"
          aria-label="Fit route"
          onClick={() => {
            if (props.pickup && props.dropoff)
              map.current?.fitBounds(
                [
                  [props.pickup.lat, props.pickup.lng],
                  [props.dropoff.lat, props.dropoff.lng],
                ],
                { padding: [65, 100] },
              );
          }}
        >
          <Navigation size={17} />
        </button>
      </div>
      <button
        className="map-layers locate-button"
        title="Use my location as pickup"
        aria-label="Use my location as pickup"
        disabled={props.active || locating}
        onClick={locate}
      >
        {locating ? (
          <LoaderCircle className="spin" size={18} />
        ) : (
          <Crosshair size={18} />
        )}
      </button>
      <div className="map-availability">
        <div className="availability-icon">
          {selecting ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <MapPin size={19} />
          )}
        </div>
        <div>
          <strong>
            {selecting
              ? "Finding the exact address…"
              : props.active
                ? "Your trip, on the map"
                : `Click the map to set ${props.mode === "pickup" ? "pickup" : "destination"}`}
          </strong>
          <span>
            {props.active
              ? "Road route · simulated driver"
              : "Pan, zoom or drag a pin. All of India is yours."}
          </span>
        </div>
      </div>
      {tilesFailed && (
        <div className="map-load-warning" role="status">
          Map tiles couldn’t load. Check your internet connection. Address
          search still works.
        </div>
      )}
    </div>
  );
}
