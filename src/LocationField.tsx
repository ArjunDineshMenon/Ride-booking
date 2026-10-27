import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MapPin, Search } from "lucide-react";
import { api, type Place } from "./api";

export default function LocationField({
  label,
  place,
  places,
  onSelect,
  onFocus,
  destination = false,
}: {
  label: string;
  place?: Place;
  places: Place[];
  onSelect: (p: Place) => void;
  onFocus?: () => void;
  destination?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Place[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [highlight, setHighlight] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const local = places.filter((p) =>
    `${p.name} ${p.address}`.toLowerCase().includes(query.toLowerCase()),
  );
  const shown = searched ? results : local.slice(0, 8);
  const choose = (p: Place) => {
    onSelect(p);
    setOpen(false);
    requestId.current++;
  };
  const search = async () => {
    if (query.trim().length < 3) {
      setError(
        "Enter at least 3 characters, including a city for better results.",
      );
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setHighlight(-1);
    try {
      const data = await api<Place[]>(
        `/places/search?q=${encodeURIComponent(query.trim())}`,
      );
      if (id === requestId.current) {
        setResults(data);
        setSearched(true);
      }
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  };
  const fieldId = destination ? "dropoff" : "pickup";
  return (
    <div className="location-field" ref={ref}>
      <span className={`location-dot ${destination ? "destination" : ""}`} />
      <div className="location-input">
        <label htmlFor={fieldId}>{label}</label>
        <input
          id={fieldId}
          value={open ? query : place?.name || ""}
          title={place?.address}
          placeholder={
            destination
              ? "Search anywhere in India"
              : "Address, landmark or map pin"
          }
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${fieldId}-options`}
          aria-activedescendant={
            highlight >= 0 ? `${fieldId}-option-${highlight}` : undefined
          }
          onFocus={() => {
            setQuery("");
            setResults([]);
            setSearched(false);
            setOpen(true);
            setError("");
            onFocus?.();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearched(false);
            setHighlight(-1);
            setError("");
            requestId.current++;
            setLoading(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              requestId.current++;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((i) => Math.min(shown.length - 1, i + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((i) => Math.max(0, i - 1));
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (highlight >= 0 && shown[highlight]) choose(shown[highlight]);
              else void search();
            }
          }}
        />
      </div>
      {open && (
        <div
          className="location-options nationwide-search"
          role="listbox"
          id={`${fieldId}-options`}
        >
          <button
            className="search-india-button"
            onClick={() => void search()}
            disabled={loading || query.trim().length < 3}
            aria-label={`Search India for ${destination ? "destination" : "pickup"}`}
          >
            {loading ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Search size={16} />
            )}
            <span>
              Search all of India
              <small>Enter an address or landmark, then press Search</small>
            </span>
          </button>
          {error && (
            <div className="search-error" role="alert">
              {error}
            </div>
          )}
          {shown.map((p, i) => (
            <button
              key={p.id}
              id={`${fieldId}-option-${i}`}
              className={highlight === i ? "highlighted" : ""}
              role="option"
              aria-selected={place?.id === p.id}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => choose(p)}
            >
              <span className="place-icon">
                <MapPin size={16} />
              </span>
              <span>
                <strong>{p.name}</strong>
                <small>{p.address}</small>
              </span>
              {place?.id === p.id && <Check size={15} />}
            </button>
          ))}
          {!shown.length && !loading && !error && (
            <div className="no-results">
              {searched
                ? "No matching addresses. Add the city or select the exact spot on the map."
                : "Press Enter to search addresses across India, or choose a point on the map."}
            </div>
          )}
          <div className="geocoder-credit">
            Address data © OpenStreetMap contributors
          </div>
        </div>
      )}
    </div>
  );
}
