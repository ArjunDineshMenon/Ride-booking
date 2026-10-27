import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  Gift,
  Heart,
  HelpCircle,
  History,
  Home,
  Leaf,
  LoaderCircle,
  LogOut,
  MapPin,
  Menu,
  Navigation,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Tag,
  Trash2,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  api,
  date,
  money,
  type Place,
  type Quote,
  type Ride,
  type Saved,
  type User,
  type WalletData,
} from "./api";
import CityMap from "./IndiaMap";
import LocationField from "./LocationField";
import PhoneLogin from "./PhoneLogin";
import VehicleArt from "./VehicleArt";

type View = "book" | "rides" | "wallet" | "saved" | "help";
type Modal =
  | "auth"
  | "fare"
  | "profile"
  | "schedule"
  | "promo"
  | "payment"
  | "cancel"
  | "rating"
  | "save"
  | "notifications"
  | null;
const STATUS: Record<string, string> = {
  matching: "Finding your ride",
  arriving: "Your driver is on the way",
  arrived: "Your driver has arrived",
  in_progress: "Enjoy the journey",
  scheduled: "Your ride is reserved",
  completed: "You’ve arrived!",
  cancelled: "Ride cancelled",
};
const NAV = [
  { id: "book", label: "Book a ride", icon: Navigation },
  { id: "rides", label: "My rides", icon: History },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "saved", label: "Saved places", icon: Heart },
] as const;

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const els = ref.current?.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href]",
        );
        if (!els?.length) return;
        if (event.shiftKey && document.activeElement === els[0]) {
          event.preventDefault();
          els[els.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === els[els.length - 1]
        ) {
          event.preventDefault();
          els[0].focus();
        }
      }
    };
    ref.current?.querySelector<HTMLElement>("input, button")?.focus();
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = bodyOverflow;
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-heading">
          <h2 id="modal-title">{title}</h2>
          <button
            className="icon-button"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [pickup, setPickup] = useState<Place>();
  const [dropoff, setDropoff] = useState<Place>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [vehicle, setVehicle] = useState("mini");
  const [payment, setPayment] = useState("cash");
  const [promo, setPromo] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [scheduled, setScheduled] = useState("");
  const [scheduleInput, setScheduleInput] = useState("");
  const [rides, setRides] = useState<Ride[]>([]);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [view, setView] = useState<View>("book");
  const [modal, setModal] = useState<Modal>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [initError, setInitError] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [authMode, setAuthMode] = useState("register");
  const [authMethod, setAuthMethod] = useState("phone");
  const [mapMode, setMapMode] = useState<"pickup" | "dropoff">("dropoff");
  const [quoteError, setQuoteError] = useState("");
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [rideFilter, setRideFilter] = useState("all");
  const [rating, setRating] = useState(5);
  const [pin, setPin] = useState("");
  const [saveLabel, setSaveLabel] = useState("");
  const [savePlace, setSavePlace] = useState("");
  const [faq, setFaq] = useState<number | null>(0);
  const quoteRequest = useRef(0);
  const initialRequest = useRef<Promise<[User, Place[]]> | null>(null);
  const active = rides.find(
    (r) => !["completed", "cancelled"].includes(r.status),
  );
  const chosen = quote?.vehicles.find((v) => v.id === vehicle);
  const rememberPlace = (place: Place) =>
    setPlaces((previous) =>
      previous.some((p) => p.id === place.id) ? previous : [place, ...previous],
    );
  const chooseMapPlace = (place: Place, mode: "pickup" | "dropoff") => {
    rememberPlace(place);
    if (mode === "pickup") {
      setPickup(place);
      setMapMode("dropoff");
    } else setDropoff(place);
  };
  const closeModal = useCallback(() => {
    setModal(null);
    setError("");
  }, []);
  const openModal = (m: Modal) => {
    setError("");
    setModal(m);
  };
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);

  const refresh = useCallback(async () => {
    const [u, r, s, w] = await Promise.all([
      api<User>("/me"),
      api<Ride[]>("/rides"),
      api<Saved[]>("/saved-places"),
      api<WalletData>("/wallet"),
    ]);
    setUser(u);
    setRides(r);
    setSaved(s);
    setWallet(w);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        initialRequest.current ??= Promise.all([
          api<User>("/auth/demo", "POST"),
          api<Place[]>("/places"),
        ]);
        const [u, p] = await initialRequest.current;
        if (cancelled) return;
        setUser(u);
        setPlaces(p);
        setPickup(p[0]);
        setDropoff(p[1]);
        await refresh();
      } catch (e) {
        if (!cancelled) setInitError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!pickup || !dropoff || !user) return;
    const request = ++quoteRequest.current;
    setQuoteLoading(true);
    setQuoteError("");
    setQuote(null);
    const t = setTimeout(async () => {
      try {
        const q = await api<Quote>("/quotes", "POST", {
          pickup_id: pickup.id,
          dropoff_id: dropoff.id,
          promo,
        });
        if (request === quoteRequest.current) {
          setQuote(q);
          setVehicle((current) =>
            q.vehicles.some((v) => v.id === current && v.available)
              ? current
              : q.vehicles.find((v) => v.available)?.id || "mini",
          );
        }
      } catch (e) {
        if (request === quoteRequest.current)
          setQuoteError((e as Error).message);
      } finally {
        if (request === quoteRequest.current) setQuoteLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      quoteRequest.current++;
    };
  }, [pickup, dropoff, promo, user?.id]);

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(async () => {
      try {
        setRides(await api<Ride[]>("/rides"));
      } catch (e) {
        notify((e as Error).message);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [active?.id]);

  const action = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const book = () =>
    action(async () => {
      if (!quote) throw new Error("Choose your route to get a fare estimate.");
      const fresh = await api<Quote>("/quotes", "POST", {
        pickup_id: pickup!.id,
        dropoff_id: dropoff!.id,
        promo,
      });
      const updatedVehicle = fresh.vehicles.find((v) => v.id === vehicle);
      if (!updatedVehicle?.available)
        throw new Error(
          updatedVehicle?.unavailable_reason || "Choose an available vehicle.",
        );
      if (updatedVehicle.fare !== chosen?.fare) {
        setQuote(fresh);
        throw new Error(
          "The route estimate changed. Please review the updated fare and book again.",
        );
      }
      const ride = await api<Ride>("/rides", "POST", {
        quote_id: fresh.id,
        vehicle,
        payment,
        scheduled_at: scheduled ? new Date(scheduled).toISOString() : null,
      });
      setRides((prev) => [ride, ...prev]);
      setPin("");
      await refresh();
      notify(
        scheduled
          ? "Your ride is reserved. You’re all set!"
          : "Let’s get you moving. Finding your demo driver…",
      );
    });

  const authenticate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    action(async () => {
      await api<User>(`/auth/${authMode}`, "POST", data);
      await refresh();
      closeModal();
      notify(
        authMode === "register"
          ? "Welcome to Roam. Your account is ready!"
          : "Welcome back!",
      );
    });
  };

  const navigate = (next: View) => {
    setView(next);
    setMobileMenu(false);
    setError("");
  };
  const repeat = (r: Ride) => {
    setPickup(r.pickup);
    setDropoff(r.dropoff);
    setVehicle(r.vehicle.id);
    setScheduled("");
    setPromo("");
    navigate("book");
  };

  if (initError)
    return (
      <div className="startup">
        <span className="brand">
          roam<span>↗</span>
        </span>
        <h1>Let’s get you connected.</h1>
        <p>{initError}</p>
        <p>
          Start the app with <code>python run.py</code>, then refresh this page.
        </p>
        <button className="primary" onClick={() => location.reload()}>
          Try again <ArrowRight size={18} />
        </button>
      </div>
    );
  if (!user)
    return (
      <div className="startup">
        <span className="brand">
          roam<span>↗</span>
        </span>
        <LoaderCircle className="spin" />
        <p>Getting your city ready…</p>
      </div>
    );

  return (
    <div className="app-shell">
      {mobileMenu && (
        <div className="sidebar-scrim" onClick={() => setMobileMenu(false)} />
      )}
      <aside className={`sidebar ${mobileMenu ? "is-open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate("book");
          }}
        >
          roam<span>↗</span>
        </a>
        <div className="brand-tag">LIFE IN MOTION</div>
        <div className="workspace-label">YOUR EVERYDAY, EASIER</div>
        <nav aria-label="Main navigation">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.id)}
              className={`nav-item ${view === item.id ? "active" : ""}`}
            >
              <item.icon size={19} />
              {item.label}
              {view === item.id && <span className="nav-active-dot" />}
              {item.id === "rides" && active && (
                <span className="nav-count">1</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-promo">
          <span className="gift-icon">
            <Gift size={22} />
          </span>
          <h3>
            Good things
            <br />
            come in rides.
          </h3>
          <p>
            Your first ride, with a little
            <br />
            something off.
          </p>
          <button
            onClick={() => {
              setPromoInput("ROAM20");
              openModal("promo");
            }}
          >
            Get 20% off <ArrowRight size={15} />
          </button>
          <div className="promo-blob" />
        </div>
        <div className="sidebar-bottom">
          <button
            className={`nav-item ${view === "help" ? "active" : ""}`}
            onClick={() => navigate("help")}
          >
            <HelpCircle size={19} />
            Help & support
            <ChevronRight size={14} />
          </button>
          <div
            className="sidebar-user"
            onClick={() => openModal("profile")}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter") openModal("profile");
            }}
          >
            <div className="avatar">{user.name[0].toUpperCase()}</div>
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.demo ? "Demo rider" : "Roam rider"}{" "}
                <Star size={10} fill="currentColor" />
              </span>
            </div>
            <Settings2 size={17} />
          </div>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={22} />
            </button>
            <span className="topbar-greeting">
              A little less waiting. A lot more living.
            </span>
          </div>
          <div className="topbar-actions">
            <span className="city-select">
              <MapPin size={15} />
              {pickup?.city || "India"}
              <span className="city-tag">IN</span>
            </span>
            <span className="topbar-divider" />
            <button
              className="notification-button"
              title="Notifications"
              aria-label="Notifications"
              onClick={() => openModal("notifications")}
            >
              <Bell size={19} />
              <span />
            </button>
            {!!user.demo && (
              <button
                className="login-header-button"
                onClick={() => openModal("auth")}
              >
                Log in
              </button>
            )}
            <button
              className="avatar small"
              aria-label="Open profile"
              onClick={() => openModal("profile")}
            >
              {user.name[0].toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                LET’S GET YOU MOVING
              </div>
              <h1>
                {view === "book" ? (
                  <>
                    Your city. <span>Your way.</span>
                  </>
                ) : view === "rides" ? (
                  <>
                    Every ride, <span>a story.</span>
                  </>
                ) : view === "wallet" ? (
                  <>
                    A little balance. <span>A lot of freedom.</span>
                  </>
                ) : view === "saved" ? (
                  <>
                    Your places. <span>One tap away.</span>
                  </>
                ) : (
                  <>
                    We’re here <span>for you.</span>
                  </>
                )}
              </h1>
              <p>
                {view === "book"
                  ? "Big plans or small errands. There’s a Roam for that."
                  : view === "rides"
                    ? "Your past journeys and what’s coming up next."
                    : view === "wallet"
                      ? "Keep your everyday journeys moving with Roam credits."
                      : view === "saved"
                        ? "Less typing. More getting there."
                        : "A helping hand, whenever you need one."}
              </p>
            </div>
            <div className="demo-pill">
              <span className="live-dot" /> INTERACTIVE DEMO
            </div>
          </div>

          {view === "book" && (
            <>
              <div className="booking-layout">
                <section className="booking-card">
                  {active ? (
                    <div className="active-trip">
                      <button
                        className="text-button"
                        onClick={() => navigate("rides")}
                      >
                        <ArrowLeft size={14} /> All rides
                      </button>
                      <div className="status-art">
                        <VehicleArt type={active.vehicle.id} />
                        <span className="status-pulse" />
                      </div>
                      <span className="eyebrow">
                        {active.status === "scheduled"
                          ? "PLANS, SORTED"
                          : "YOUR JOURNEY"}
                      </span>
                      <h2>{STATUS[active.status]}</h2>
                      <p>
                        {active.status === "matching"
                          ? "Matching you with a nearby demo driver…"
                          : active.status === "scheduled"
                            ? date(active.scheduled_at!)
                            : active.status === "in_progress"
                              ? `${active.duration} min · ${active.distance} km to your destination`
                              : `${active.driver.name.split(" ")[0]} will meet you at ${active.pickup.name}.`}
                      </p>
                      <div className="trip-progress">
                        {["matching", "arriving", "arrived", "in_progress"].map(
                          (s, i) => (
                            <span
                              key={s}
                              className={
                                [
                                  "matching",
                                  "arriving",
                                  "arrived",
                                  "in_progress",
                                ].indexOf(active.status) >= i
                                  ? "done"
                                  : ""
                              }
                            />
                          ),
                        )}
                      </div>
                      {active.status !== "matching" &&
                        active.status !== "scheduled" && (
                          <>
                            <div className="driver-card">
                              <div className="driver-avatar">RK</div>
                              <div>
                                <strong>{active.driver.name}</strong>
                                <span>
                                  <Star size={12} fill="currentColor" />{" "}
                                  {active.driver.rating} ·{" "}
                                  {active.driver.trips.toLocaleString()} trips
                                </span>
                              </div>
                              <ShieldCheck size={22} />
                            </div>
                            <div className="driver-vehicle">
                              <strong>{active.driver.plate}</strong>
                              <span>{active.driver.vehicle}</span>
                            </div>
                            <div className="pin-box">
                              <div>
                                <span>Your ride PIN</span>
                                <small>Share when your driver arrives</small>
                              </div>
                              <strong>
                                {active.pin.split("").map((n, i) => (
                                  <span key={i}>{n}</span>
                                ))}
                              </strong>
                            </div>
                          </>
                        )}
                      <div className="trip-route">
                        <p>
                          <span className="location-dot" />
                          {active.pickup.name}
                        </p>
                        <div className="route-connector" />
                        <p>
                          <span className="location-dot destination" />
                          {active.dropoff.name}
                        </p>
                      </div>
                      <div className="trip-total">
                        <span>
                          {active.vehicle.name} ·{" "}
                          {active.payment === "wallet" ? "Roam Wallet" : "Cash"}
                        </span>
                        <strong>{money(active.fare)}</strong>
                      </div>
                      {["arriving", "arrived"].includes(active.status) && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            action(async () => {
                              await api(`/rides/${active.id}/start`, "POST", {
                                pin,
                              });
                              await refresh();
                            });
                          }}
                          className="pin-form"
                        >
                          <input
                            aria-label="Enter ride PIN"
                            placeholder="Enter the 4-digit ride PIN"
                            inputMode="numeric"
                            pattern="[0-9]{4}"
                            maxLength={4}
                            value={pin}
                            onChange={(e) => setPin(e.target.value)}
                            required
                          />
                          <button className="primary" disabled={busy}>
                            Start demo trip <ArrowRight size={17} />
                          </button>
                        </form>
                      )}
                      {active.status === "in_progress" && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              const r = await api<Ride>(
                                `/rides/${active.id}/complete`,
                                "POST",
                              );
                              setSelectedRide(r);
                              setRating(5);
                              setPromo("");
                              await refresh();
                              openModal("rating");
                            })
                          }
                        >
                          Finish demo trip <CheckCheck size={18} />
                        </button>
                      )}
                      {!["in_progress"].includes(active.status) && (
                        <button
                          className="cancel-button"
                          onClick={() => openModal("cancel")}
                        >
                          Cancel ride
                        </button>
                      )}
                      {error && (
                        <div className="error-message" role="alert">
                          {error}
                        </div>
                      )}
                      <p className="demo-note">
                        Simulated driver and trip. No real ride is dispatched.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="booking-title">
                        <div className="section-icon">
                          <Navigation size={19} />
                        </div>
                        <h2>Where are we headed?</h2>
                        <span className="ride-label">RIDE</span>
                      </div>
                      <div className="journey-fields">
                        <LocationField
                          label="PICKUP LOCATION"
                          place={pickup}
                          places={places}
                          onFocus={() => setMapMode("pickup")}
                          onSelect={(p) => {
                            rememberPlace(p);
                            setPickup(p);
                          }}
                        />
                        <span className="field-connector" />
                        <div className="field-divider" />
                        <LocationField
                          label="DROP-OFF LOCATION"
                          place={dropoff}
                          places={places}
                          onFocus={() => setMapMode("dropoff")}
                          onSelect={(p) => {
                            rememberPlace(p);
                            setDropoff(p);
                          }}
                          destination
                        />
                        <button
                          className="swap-button"
                          aria-label="Swap pickup and destination"
                          title="Swap locations"
                          onClick={() => {
                            setPickup(dropoff);
                            setDropoff(pickup);
                          }}
                        >
                          <ArrowDownUp size={16} />
                        </button>
                      </div>
                      <div className="quick-places">
                        {saved.slice(0, 2).map((s) => (
                          <button
                            key={s.id}
                            onClick={() => setDropoff(s.place)}
                          >
                            {s.label.toLowerCase() === "home" ? (
                              <Home size={13} />
                            ) : (
                              <BriefcaseBusiness size={13} />
                            )}{" "}
                            {s.label}
                          </button>
                        ))}
                        <button
                          onClick={() => {
                            setSavePlace(dropoff?.id || places[0]?.id);
                            openModal("save");
                          }}
                        >
                          <Plus size={13} /> Save a place
                        </button>
                      </div>
                      <button
                        className={`schedule-control ${scheduled ? "scheduled" : ""}`}
                        onClick={() => {
                          setScheduleInput(scheduled);
                          openModal("schedule");
                        }}
                      >
                        <Clock3 size={16} />
                        <span>{scheduled ? date(scheduled) : "Leave now"}</span>
                        <ChevronDown size={14} />
                        <span className="schedule-separator" />
                        <CalendarDays size={15} />
                        <small>
                          {scheduled ? "Edit schedule" : "Schedule for later"}
                        </small>
                      </button>
                      <div className="choose-heading">
                        <h3>Choose your kind of ride</h3>
                        {quote && (
                          <span>
                            {quote.distance} km · {quote.duration} min
                          </span>
                        )}
                      </div>
                      <div
                        className={`vehicle-list ${quoteLoading ? "loading" : ""}`}
                        role="radiogroup"
                        aria-label="Choose vehicle"
                      >
                        {quote?.vehicles.map((v) => (
                          <button
                            role="radio"
                            aria-checked={vehicle === v.id}
                            disabled={!v.available}
                            className={`vehicle-option ${vehicle === v.id ? "selected" : ""}`}
                            key={v.id}
                            onClick={() => setVehicle(v.id)}
                          >
                            <VehicleArt type={v.id} />
                            <div className="vehicle-copy">
                              <div>
                                <strong>{v.name}</strong>
                                <span className="vehicle-seats">
                                  <Users size={10} />
                                  {v.seats}
                                </span>
                                {v.badge && (
                                  <span
                                    className={`vehicle-badge ${v.id === "mini" ? "popular" : ""}`}
                                  >
                                    {v.badge}
                                  </span>
                                )}
                              </div>
                              <span>
                                {v.available ? v.tagline : v.unavailable_reason}
                              </span>
                              <small>
                                <Clock3 size={10} />
                                {v.eta} min away
                              </small>
                            </div>
                            <div className="vehicle-price">
                              <strong>{money(v.fare)}</strong>
                              <span className="radio-circle">
                                {vehicle === v.id && <span />}
                              </span>
                            </div>
                          </button>
                        ))}
                        {!quote && (
                          <div className="quote-placeholder">
                            {quoteLoading ? (
                              <>
                                <LoaderCircle className="spin" size={23} />
                                <span>Finding your fare…</span>
                              </>
                            ) : (
                              <>
                                <MapPin size={23} />
                                <span>
                                  {quoteError ||
                                    "Choose two different locations to see your rides."}
                                </span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {quote && (
                        <div className="route-estimate-info">
                          <span>
                            {quote.pricing.trip_type === "intercity"
                              ? "INTERCITY"
                              : quote.pricing.zone}{" "}
                            ·{" "}
                            {quote.route.source === "osrm"
                              ? "Road route"
                              : "Approximate distance"}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => openModal("fare")}
                          >
                            Fare details <ChevronRight size={12} />
                          </button>
                        </div>
                      )}
                      {quote?.route.warning && (
                        <div className="routing-warning" role="status">
                          {quote.route.warning}
                        </div>
                      )}
                      <button
                        className="offer-control"
                        onClick={() => {
                          setPromoInput(promo);
                          openModal("promo");
                        }}
                      >
                        <span className="offer-icon">
                          <Tag size={16} />
                        </span>
                        <span>
                          {promo ? (
                            <>
                              ROAM20 applied{" "}
                              <small>Enjoy 20% off, up to ₹50</small>
                            </>
                          ) : (
                            <>
                              A little treat for your first ride{" "}
                              <small>Use ROAM20 to save 20%</small>
                            </>
                          )}
                        </span>
                        {promo ? (
                          <Check size={16} />
                        ) : (
                          <ChevronRight size={17} />
                        )}
                      </button>
                      <button
                        className="payment-control"
                        onClick={() => openModal("payment")}
                      >
                        <span>
                          <Wallet size={17} />
                          {payment === "wallet"
                            ? "Roam Wallet"
                            : "Pay with cash"}
                          <ChevronDown size={13} />
                        </span>
                        <small>
                          {payment === "wallet"
                            ? `${money(user.wallet / 100)} available`
                            : "Pay after your ride"}
                        </small>
                      </button>
                      {error && (
                        <div className="error-message" role="alert">
                          {error}
                        </div>
                      )}
                      <button
                        className="primary book-button"
                        disabled={busy || !quote || quoteLoading}
                        onClick={book}
                      >
                        <span>
                          {busy
                            ? "Booking your ride…"
                            : scheduled
                              ? `Schedule ${chosen?.name || "ride"}`
                              : `Book ${chosen?.name || "a ride"}`}
                        </span>
                        <span>
                          {busy ? (
                            <LoaderCircle className="spin" size={20} />
                          ) : (
                            <>
                              {chosen && money(chosen.fare)}
                              <ArrowRight size={19} />
                            </>
                          )}
                        </span>
                      </button>
                      <div className="fare-note">
                        <ShieldCheck size={12} /> Tolls, parking and permits
                        extra. See fare details.
                      </div>
                    </>
                  )}
                </section>
                <section className="map-section">
                  <CityMap
                    pickup={active?.pickup || pickup}
                    dropoff={active?.dropoff || dropoff}
                    active={!!active}
                    route={active?.route || quote?.route}
                    mode={mapMode}
                    onMode={setMapMode}
                    onSelect={chooseMapPlace}
                    onError={notify}
                  />
                  <div className="map-caption">
                    <span>
                      <ShieldCheck size={15} />
                      <strong>A little peace of mind, every mile.</strong>
                    </span>
                    <span>
                      Ride PIN verification <span className="caption-dot" />{" "}
                      Upfront fares
                    </span>
                  </div>
                  <div className="journey-editorial">
                    <div>
                      <span className="eyebrow">THE EVERYDAY, UPGRADED</span>
                      <h3>
                        Less “where’s my ride?”
                        <br />
                        More <span>“I’m on my way.”</span>
                      </h3>
                      <p>
                        From the first coffee to the last plan.
                        <br />
                        We’re here for all the in-betweens.
                      </p>
                    </div>
                    <div className="editorial-art">
                      <div className="art-sun" />
                      <svg viewBox="0 0 270 150" aria-hidden="true">
                        <path
                          d="M-10 130Q70 90 150 118T290 100"
                          fill="none"
                          stroke="#ED4267"
                          strokeWidth="26"
                        />
                        <path
                          d="M-10 130Q70 90 150 118T290 100"
                          fill="none"
                          stroke="#FFF1EE"
                          strokeWidth="2"
                          strokeDasharray="11 10"
                        />
                        <path
                          d="M40 110V50h18v60M66 104V31h29v73M100 105V62h18v43M186 110V53h29v57M223 109V74h22v35"
                          fill="#DFC8BE"
                        />
                        <path
                          d="M72 40h5v6h-5M84 40h5v6h-5M72 53h5v6h-5M84 53h5v6h-5M193 62h6v7h-6M204 62h6v7h-6M193 77h6v7h-6"
                          fill="#FFF6EA"
                        />
                        <path
                          d="M134 108V67M154 110V54"
                          stroke="#738A65"
                          strokeWidth="4"
                        />
                        <circle cx="134" cy="66" r="15" fill="#9EAD82" />
                        <circle cx="154" cy="51" r="20" fill="#B3BC94" />
                      </svg>
                      <VehicleArt type="auto" />
                    </div>
                  </div>
                </section>
              </div>
              <div className="benefits">
                <div>
                  <span>
                    <ShieldCheck size={21} />
                  </span>
                  <div>
                    <strong>Your safety rides with us</strong>
                    <small>Ride PINs. Verified journeys. Peace of mind.</small>
                  </div>
                </div>
                <div>
                  <span>
                    <CreditCard size={21} />
                  </span>
                  <div>
                    <strong>Fair fares. Full transparency.</strong>
                    <small>Know your estimate before you go.</small>
                  </div>
                </div>
                <div>
                  <span>
                    <Leaf size={21} />
                  </span>
                  <div>
                    <strong>A ride for every kind of day</strong>
                    <small>
                      Two wheels, three wheels, or a little more room.
                    </small>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === "rides" && (
            <section className="content-panel">
              <div className="panel-heading">
                <h2>
                  Your journeys{" "}
                  <span className="count-chip">{rides.length}</span>
                </h2>
                <div className="filter-tabs">
                  {["all", "upcoming", "completed", "cancelled"].map((f) => (
                    <button
                      className={rideFilter === f ? "selected" : ""}
                      key={f}
                      onClick={() => setRideFilter(f)}
                    >
                      {f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              {rides
                .filter(
                  (r) =>
                    rideFilter === "all" ||
                    (rideFilter === "upcoming"
                      ? !["completed", "cancelled"].includes(r.status)
                      : r.status === rideFilter),
                )
                .map((r) => (
                  <div className="history-ride" key={r.id}>
                    <div className="history-art">
                      <VehicleArt type={r.vehicle.id} />
                    </div>
                    <div className="history-copy">
                      <span className={`status-chip ${r.status}`}>
                        {r.status.replace("_", " ")}
                      </span>
                      <h3>
                        {r.pickup.name}
                        <ArrowRight size={15} />
                        {r.dropoff.name}
                      </h3>
                      <p>
                        {date(r.created_at)} · {r.vehicle.name} · {r.distance}{" "}
                        km
                      </p>
                      {r.scheduled_at && r.status === "scheduled" && (
                        <p>Scheduled for {date(r.scheduled_at)}</p>
                      )}
                      {r.rating && (
                        <span className="stars">{"★".repeat(r.rating)}</span>
                      )}
                    </div>
                    <div className="history-actions">
                      <strong>{money(r.fare)}</strong>
                      {r.status === "completed" ? (
                        <>
                          <div>
                            <a
                              className="icon-button"
                              href={`/api/rides/${r.id}/receipt`}
                              title="Download receipt"
                              aria-label="Download receipt"
                            >
                              <Download size={16} />
                            </a>
                            <button
                              className="text-button"
                              onClick={() => {
                                setSelectedRide(r);
                                setRating(r.rating || 5);
                                openModal("rating");
                              }}
                            >
                              {r.rating ? "Edit rating" : "Rate ride"}
                            </button>
                          </div>
                          <button
                            className="secondary small-button"
                            onClick={() => repeat(r)}
                          >
                            Ride again <ArrowRight size={14} />
                          </button>
                        </>
                      ) : r.status === "cancelled" ? (
                        <button
                          className="secondary small-button"
                          onClick={() => repeat(r)}
                        >
                          Ride again <ArrowRight size={14} />
                        </button>
                      ) : (
                        <button
                          className="secondary small-button"
                          onClick={() => navigate("book")}
                        >
                          View ride <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              {!rides.filter(
                (r) =>
                  rideFilter === "all" ||
                  (rideFilter === "upcoming"
                    ? !["completed", "cancelled"].includes(r.status)
                    : r.status === rideFilter),
              ).length && (
                <div className="empty-state">
                  <History size={38} />
                  <h3>Your next story starts with a ride.</h3>
                  <p>
                    {rideFilter === "all"
                      ? "Book your first Roam and find your journeys here."
                      : `No ${rideFilter} rides yet.`}
                  </p>
                  <button className="primary" onClick={() => navigate("book")}>
                    Let’s go somewhere <ArrowRight size={17} />
                  </button>
                </div>
              )}
            </section>
          )}

          {view === "wallet" && (
            <div className="wallet-layout">
              <section className="wallet-card">
                <div className="wallet-brand">
                  roam<span>pay</span>
                  <Wallet size={25} />
                </div>
                <span className="wallet-caption">
                  YOUR AVAILABLE DEMO CREDITS
                </span>
                <h2>{money((wallet?.balance || 0) / 100)}</h2>
                <p>A smooth start to your next journey.</p>
                <div className="topup-options">
                  {[100, 500, 1000].map((amount) => (
                    <button
                      key={amount}
                      disabled={busy}
                      onClick={() =>
                        action(async () => {
                          await api("/wallet/topup", "POST", { amount });
                          await refresh();
                          notify(
                            `${money(amount)} demo credits added. Happy roaming!`,
                          );
                        })
                      }
                    >
                      <Plus size={15} />
                      {money(amount)}
                    </button>
                  ))}
                </div>
                <small>
                  <ShieldCheck size={13} /> Demo credits only. No money is
                  charged.
                </small>
                {error && <div className="error-message">{error}</div>}
              </section>
              <section className="content-panel ledger">
                <h2>Wallet activity</h2>
                {wallet?.transactions.map((t) => (
                  <div className="ledger-row" key={t.id}>
                    <span
                      className={`ledger-icon ${t.amount < 0 ? "debit" : ""}`}
                    >
                      {t.amount < 0 ? (
                        <Navigation size={18} />
                      ) : (
                        <Plus size={18} />
                      )}
                    </span>
                    <div>
                      <strong>{t.description}</strong>
                      <small>{date(t.created)}</small>
                    </div>
                    <strong className={t.amount > 0 ? "credit" : ""}>
                      {t.amount > 0 ? "+" : "−"}
                      {money(Math.abs(t.amount) / 100)}
                    </strong>
                  </div>
                ))}
                {!wallet?.transactions.length && (
                  <p className="muted">
                    Your wallet activity will appear here.
                  </p>
                )}
              </section>
            </div>
          )}

          {view === "saved" && (
            <section className="content-panel">
              <div className="panel-heading">
                <h2>Familiar places, faster</h2>
                <button
                  className="primary compact"
                  onClick={() => {
                    setSaveLabel("");
                    setSavePlace(places[0]?.id);
                    openModal("save");
                  }}
                >
                  <Plus size={16} />
                  Add a place
                </button>
              </div>
              <div className="saved-grid">
                {saved.map((s) => (
                  <article className="saved-card" key={s.id}>
                    <div className="saved-card-top">
                      <span className="saved-icon">
                        {s.label.toLowerCase() === "home" ? (
                          <Home />
                        ) : s.label.toLowerCase() === "work" ? (
                          <BriefcaseBusiness />
                        ) : (
                          <MapPin />
                        )}
                      </span>
                      <button
                        className="icon-button"
                        title="Remove saved place"
                        aria-label={`Remove ${s.label}`}
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await api(`/saved-places/${s.id}`, "DELETE");
                            await refresh();
                            notify("Saved place removed.");
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <h3>{s.label}</h3>
                    <strong>{s.place.name}</strong>
                    <p>{s.place.address}</p>
                    <button
                      className="text-button"
                      onClick={() => {
                        setDropoff(s.place);
                        navigate("book");
                      }}
                    >
                      Ride here <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
              </div>
              {!saved.length && (
                <div className="empty-state">
                  <Heart size={38} />
                  <h3>Your favorites belong here.</h3>
                  <p>Save home, work, or anywhere life takes you.</p>
                </div>
              )}
              {error && <div className="error-message">{error}</div>}
            </section>
          )}

          {view === "help" && (
            <div className="help-layout">
              <div className="help-intro">
                <div className="help-art">
                  <HelpCircle size={54} />
                  <Sparkles size={22} />
                </div>
                <h2>
                  A little help goes
                  <br />a long way.
                </h2>
                <p>
                  Everything you need to know about getting around with Roam.
                </p>
                <div className="help-note">
                  <ShieldCheck size={23} />
                  <div>
                    <strong>This is a working demo</strong>
                    <p>
                      Drivers, trip progress, wallet credits, and fares are
                      simulated. No real rides or payments are processed.
                    </p>
                  </div>
                </div>
              </div>
              <section className="content-panel faq">
                {[
                  [
                    "How do I book my first ride?",
                    "Search an address or landmark anywhere in India and press Search, or choose Pickup or Destination on the map and click the exact spot. Select an available vehicle and book. Drivers remain simulated.",
                  ],
                  [
                    "How does the demo trip work?",
                    "After booking, wait for the driver to be assigned. Enter the four-digit PIN shown on your ride card and select Start demo trip. Select Finish demo trip to complete your journey, leave a rating, and download a receipt.",
                  ],
                  [
                    "How are fares calculated?",
                    "The Python backend uses road distance and duration, then applies configurable city or intercity tariffs, minimum fare, platform fee, airport fee where relevant, and discounts. Select Fare details for a breakdown. If routing is unavailable, an approximate estimate is clearly labeled. Tolls, parking and permits are excluded.",
                  ],
                  [
                    "Can I schedule or cancel a ride?",
                    "Yes. Select Schedule for later and pick a time between 5 minutes and 7 days ahead. You can cancel any ride before it starts at no charge. Wallet payments are refunded automatically.",
                  ],
                  [
                    "How do payments and offers work?",
                    "Choose cash or Roam Wallet. Your wallet starts with ₹500 in demo credits and you can add more on the Wallet page. ROAM20 saves 20% (up to ₹50) on your first non-cancelled ride. No real money changes hands.",
                  ],
                  [
                    "Will my rides be saved?",
                    "Your demo profile, bookings, wallet activity, and saved places persist in the local database. Sign back in with your phone and a one-time code, or use email and password. Local phone codes are for development until an SMS provider is configured. The default demo session lasts seven days.",
                  ],
                  [
                    "Is Firebase connected?",
                    "Firebase is deferred. The app currently runs on a Python 3 FastAPI backend with SQLite and secure cookie sessions. No Firebase credentials are needed.",
                  ],
                ].map(([q, a], i) => (
                  <div
                    key={q}
                    className={`faq-item ${faq === i ? "open" : ""}`}
                  >
                    <button
                      aria-expanded={faq === i}
                      onClick={() => setFaq(faq === i ? null : i)}
                    >
                      {q}
                      <ChevronDown size={17} />
                    </button>
                    {faq === i && <p>{a}</p>}
                  </div>
                ))}
              </section>
            </div>
          )}

          <footer>
            <span className="footer-brand">
              roam<span>↗</span>
            </span>
            <span>Made for the way you move.</span>
            <span className="footer-right">
              Made for India, with love <Heart size={11} />
              <span>© {new Date().getFullYear()} Roam</span>
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span>
            <Check size={16} />
          </span>
          {toast}
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {modal && (
        <ModalShell
          title={
            {
              auth:
                authMode === "register"
                  ? "Make yourself at home."
                  : "Welcome back.",
              profile: "Your little corner of Roam",
              schedule: "Good plans start here.",
              promo: "A little something for the ride.",
              payment: "How would you like to pay?",
              cancel: "Change of plans?",
              rating: "How was your journey?",
              save: "Keep a good place close.",
              notifications: "Your Roam updates",
              fare: "Every rupee, explained.",
            }[modal]
          }
          onClose={closeModal}
        >
          {modal === "fare" && quote && chosen && (
            <div className="fare-details">
              <div className="fare-summary">
                <VehicleArt type={chosen.id} />
                <div>
                  <h3>{chosen.name}</h3>
                  <p>
                    {quote.distance} km · {quote.duration} min ·{" "}
                    {quote.pricing.zone}
                  </p>
                </div>
              </div>
              <div className="fare-rate">
                {quote.pricing.trip_type === "intercity" ? "Intercity" : "City"}{" "}
                tariff · ₹{chosen.per_km}/km
                {chosen.per_minute > 0 ? ` + ₹${chosen.per_minute}/min` : ""}
              </div>
              {Object.entries(chosen.breakdown)
                .filter(([, amount]) => amount !== 0)
                .map(([key, amount]) => (
                  <div className="fare-breakdown-row" key={key}>
                    <span>
                      {{
                        base: "Base fare",
                        distance: "Distance fare",
                        time: "Travel time",
                        minimum_adjustment: "Minimum fare adjustment",
                        airport: "Airport pickup / drop-off",
                        platform: "Platform fee",
                        discount: "Offer discount",
                      }[key] || key}
                    </span>
                    <strong>
                      {key === "discount" ? "−" : ""}
                      {money(amount)}
                    </strong>
                  </div>
                ))}
              <div className="fare-breakdown-row total">
                <span>Estimated total</span>
                <strong>{money(chosen.fare)}</strong>
              </div>
              <p className="modal-description">{quote.pricing.notice}</p>
              {quote.route.warning && (
                <div className="routing-warning">{quote.route.warning}</div>
              )}
              <p className="tariff-disclosure">
                These are configurable Roam app tariffs, not official government
                or operator rates. Road travel time excludes live traffic.
                Tariff version {quote.pricing.version}.
              </p>
            </div>
          )}
          {modal === "auth" && (
            <>
              <div className="filter-tabs auth-method-tabs">
                <button
                  className={authMethod === "phone" ? "selected" : ""}
                  onClick={() => setAuthMethod("phone")}
                >
                  Phone number
                </button>
                <button
                  className={authMethod === "email" ? "selected" : ""}
                  onClick={() => setAuthMethod("email")}
                >
                  Email & password
                </button>
              </div>
              {authMethod === "phone" ? (
                <PhoneLogin
                  onSuccess={async () => {
                    await refresh();
                    closeModal();
                    notify("You're signed in. Your journeys are ready.");
                  }}
                />
              ) : (
                <>
                  <p className="modal-description">
                    {authMode === "register"
                      ? "Create your account and keep every journey in one place."
                      : "Your city is waiting. Sign in to get moving."}
                  </p>
                  <div className="filter-tabs auth-tabs">
                    {["register", "login"].map((mode) => (
                      <button
                        key={mode}
                        className={authMode === mode ? "selected" : ""}
                        onClick={() => {
                          setAuthMode(mode);
                          setError("");
                        }}
                      >
                        {mode === "register" ? "Create account" : "Sign in"}
                      </button>
                    ))}
                  </div>
                  <form onSubmit={authenticate} className="modal-form">
                    {authMode === "register" && (
                      <label>
                        Your name
                        <input
                          name="name"
                          placeholder="e.g. Alex Sharma"
                          minLength={2}
                          maxLength={60}
                          autoComplete="name"
                          required
                        />
                      </label>
                    )}
                    <label>
                      Email address
                      <input
                        type="email"
                        name="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        required
                      />
                    </label>
                    <label>
                      Password
                      <input
                        type="password"
                        name="password"
                        placeholder="At least 8 characters"
                        minLength={8}
                        maxLength={128}
                        autoComplete={
                          authMode === "register"
                            ? "new-password"
                            : "current-password"
                        }
                        required
                      />
                    </label>
                    {error && (
                      <div className="error-message" role="alert">
                        {error}
                      </div>
                    )}
                    <button className="primary" disabled={busy}>
                      {busy
                        ? "One moment…"
                        : authMode === "register"
                          ? "Create account"
                          : "Sign in"}
                      <ArrowRight size={17} />
                    </button>
                  </form>
                </>
              )}
            </>
          )}
          {modal === "profile" && (
            <>
              <div className="profile-header">
                <div className="avatar large">{user.name[0].toUpperCase()}</div>
                <div>
                  <h3>{user.name}</h3>
                  <p>
                    {user.phone ||
                      user.email ||
                      "Exploring with a demo profile"}
                  </p>
                </div>
              </div>
              <form
                className="modal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const data = Object.fromEntries(
                    new FormData(e.currentTarget),
                  );
                  action(async () => {
                    await api("/me", "PATCH", data);
                    await refresh();
                    closeModal();
                    notify("Your profile is up to date.");
                  });
                }}
              >
                <label>
                  Name
                  <input
                    name="name"
                    defaultValue={user.name}
                    minLength={2}
                    maxLength={60}
                    required
                  />
                </label>
                <label>
                  Contact phone <small>(for profile only)</small>
                  <input
                    name="phone"
                    defaultValue={user.phone}
                    placeholder="+91 98765 43210"
                    pattern="[+0-9 ()-]*"
                    maxLength={20}
                  />
                </label>
                {error && <div className="error-message">{error}</div>}
                <button className="primary" disabled={busy}>
                  Save changes
                  <Check size={17} />
                </button>
              </form>
              <div className="profile-auth">
                {user.demo ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      setAuthMode("register");
                      openModal("auth");
                    }}
                  >
                    <UserRound size={16} /> Create account or sign in
                  </button>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      action(async () => {
                        await api("/auth/logout", "POST");
                        await api("/auth/demo", "POST");
                        await refresh();
                        closeModal();
                        navigate("book");
                        notify(
                          "You’re signed out. A fresh demo profile is ready.",
                        );
                      })
                    }
                  >
                    <LogOut size={16} />
                    Sign out
                  </button>
                )}
              </div>
            </>
          )}
          {modal === "schedule" && (
            <>
              <p className="modal-description">
                One less thing to think about. Reserve a demo ride from 5
                minutes to 7 days ahead.
              </p>
              <form
                className="modal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = String(
                    new FormData(e.currentTarget).get("scheduled_at") || "",
                  );
                  const ms = new Date(value).getTime();
                  if (
                    !Number.isFinite(ms) ||
                    ms < Date.now() + 300000 ||
                    ms > Date.now() + 7 * 86400000
                  ) {
                    setError(
                      "Pick a time between 5 minutes and 7 days from now.",
                    );
                    return;
                  }
                  setScheduled(value);
                  closeModal();
                }}
              >
                <label>
                  Pickup date & time
                  <input
                    type="datetime-local"
                    name="scheduled_at"
                    defaultValue={scheduleInput}
                    onChange={(e) => setScheduleInput(e.target.value)}
                    min={new Date(
                      Date.now() +
                        6 * 60000 -
                        new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)}
                    max={new Date(
                      Date.now() +
                        7 * 86400000 -
                        new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)}
                    required
                  />
                </label>
                {error && <div className="error-message">{error}</div>}
                <button className="primary">
                  Set pickup time
                  <CalendarDays size={18} />
                </button>
                <button
                  type="button"
                  className="text-button centered"
                  onClick={() => {
                    setScheduled("");
                    closeModal();
                  }}
                >
                  Actually, let’s leave now
                </button>
              </form>
            </>
          )}
          {modal === "promo" && (
            <>
              <div className="promo-ticket">
                <Gift size={32} />
                <div>
                  <strong>Your first ride, 20% sweeter.</strong>
                  <p>Save up to ₹50 with ROAM20.</p>
                </div>
                <span>
                  20%<small>OFF</small>
                </span>
              </div>
              <p className="modal-description">
                Valid once per rider on a non-cancelled ride.
              </p>
              <form
                className="modal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    if (!pickup || !dropoff)
                      throw new Error("Choose your route first.");
                    const q = await api<Quote>("/quotes", "POST", {
                      pickup_id: pickup.id,
                      dropoff_id: dropoff.id,
                      promo: promoInput,
                    });
                    setPromo(q.promo);
                    setQuote(q);
                    closeModal();
                    notify(
                      q.promo
                        ? "Offer applied. A little more joy for less."
                        : "Offer removed.",
                    );
                  });
                }}
              >
                <label>
                  Offer code
                  <input
                    placeholder="Enter offer code"
                    value={promoInput}
                    onChange={(e) =>
                      setPromoInput(e.target.value.toUpperCase())
                    }
                  />
                </label>
                {error && <div className="error-message">{error}</div>}
                <button className="primary" disabled={busy}>
                  Apply offer
                  <Tag size={17} />
                </button>
                {promo && (
                  <button
                    type="button"
                    className="text-button centered"
                    onClick={() => {
                      setPromo("");
                      closeModal();
                    }}
                  >
                    Remove offer
                  </button>
                )}
              </form>
            </>
          )}
          {modal === "payment" && (
            <>
              <p className="modal-description">
                Choose what works for you. No real payments are processed in
                this demo.
              </p>
              <div className="payment-options">
                {[
                  {
                    id: "cash",
                    title: "Cash",
                    desc: "Pay your driver after the ride",
                    icon: CreditCard,
                  },
                  {
                    id: "wallet",
                    title: "Roam Wallet",
                    desc: `${money(user.wallet / 100)} demo credits available`,
                    icon: Wallet,
                  },
                ].map((p) => (
                  <button
                    key={p.id}
                    className={payment === p.id ? "selected" : ""}
                    onClick={() => setPayment(p.id)}
                  >
                    <p.icon size={23} />
                    <span>
                      <strong>{p.title}</strong>
                      <small>{p.desc}</small>
                    </span>
                    <span className="radio-circle">
                      {payment === p.id && <span />}
                    </span>
                  </button>
                ))}
              </div>
              <button className="primary" onClick={closeModal}>
                Done
                <Check size={17} />
              </button>
            </>
          )}
          {modal === "cancel" && (
            <>
              <div className="cancel-art">
                <CalendarDays size={35} />
              </div>
              <p className="modal-description">
                Life happens. Cancel this ride at no charge.
                {active?.payment === "wallet" &&
                  ` Your ${money(active.fare)} in demo credits will be returned to your wallet.`}
              </p>
              {error && <div className="error-message">{error}</div>}
              <div className="modal-form">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      await api(`/rides/${active!.id}/cancel`, "POST");
                      await refresh();
                      closeModal();
                      notify("Ride cancelled. We’ll be here for the next one.");
                    })
                  }
                >
                  Yes, cancel ride
                </button>
                <button className="secondary" onClick={closeModal}>
                  Keep my ride
                </button>
              </div>
            </>
          )}
          {modal === "rating" && selectedRide && (
            <>
              <div className="rating-success">
                <span>
                  <CheckCheck size={29} />
                </span>
                <h3>A good day to get there.</h3>
                <p>
                  {selectedRide.pickup.name} to {selectedRide.dropoff.name}
                </p>
                <strong>{money(selectedRide.fare)}</strong>
              </div>
              <p className="modal-description centered">
                How was your ride with {selectedRide.driver.name.split(" ")[0]}?
              </p>
              <div
                className="rating-stars"
                role="radiogroup"
                aria-label="Rate your ride"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    role="radio"
                    aria-checked={rating === n}
                    aria-label={`${n} star${n > 1 ? "s" : ""}`}
                    onClick={() => setRating(n)}
                  >
                    <Star
                      size={35}
                      fill={n <= rating ? "#E8B449" : "none"}
                      stroke={n <= rating ? "#E8B449" : "#D9D7D2"}
                    />
                  </button>
                ))}
              </div>
              {error && <div className="error-message">{error}</div>}
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api(`/rides/${selectedRide.id}/rating`, "POST", {
                      rating,
                    });
                    await refresh();
                    closeModal();
                    notify("Thanks for sharing a little love. Rating saved!");
                  })
                }
              >
                Send a little love
                <Heart size={17} />
              </button>
              <a
                className="text-button receipt-link"
                href={`/api/rides/${selectedRide.id}/receipt`}
              >
                <Download size={15} />
                Download receipt
              </a>
            </>
          )}
          {modal === "save" && (
            <>
              <p className="modal-description">
                Home, work, or your favorite coffee spot. Save it for the next
                time.
              </p>
              <form
                className="modal-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await api("/saved-places", "POST", {
                      label: saveLabel,
                      place_id: savePlace,
                    });
                    await refresh();
                    closeModal();
                    setSaveLabel("");
                    notify("A familiar place, saved.");
                  });
                }}
              >
                <label>
                  Give it a name
                  <input
                    placeholder="e.g. My coffee spot"
                    value={saveLabel}
                    onChange={(e) => setSaveLabel(e.target.value)}
                    maxLength={30}
                    required
                  />
                </label>
                <LocationField
                  label="SEARCH FOR A PLACE"
                  place={places.find((p) => p.id === savePlace)}
                  places={places}
                  onSelect={(p) => {
                    rememberPlace(p);
                    setSavePlace(p.id);
                  }}
                />

                {error && <div className="error-message">{error}</div>}
                <button className="primary" disabled={busy}>
                  Save this place
                  <Heart size={17} />
                </button>
              </form>
            </>
          )}
          {modal === "notifications" && (
            <div className="notifications">
              <div>
                <span className="notification-icon">
                  <Gift size={20} />
                </span>
                <div>
                  <strong>A little welcome gift</strong>
                  <p>
                    Enjoy 20% off your first ride with ROAM20. Your next journey
                    just got a little sweeter.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPromoInput("ROAM20");
                      openModal("promo");
                    }}
                  >
                    View offer <ArrowRight size={14} />
                  </button>
                </div>
              </div>
              {active && (
                <div>
                  <span className="notification-icon">
                    <Navigation size={20} />
                  </span>
                  <div>
                    <strong>{STATUS[active.status]}</strong>
                    <p>
                      Your {active.vehicle.name} from {active.pickup.name} to{" "}
                      {active.dropoff.name}.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => {
                        navigate("book");
                        closeModal();
                      }}
                    >
                      View ride
                      <ArrowRight size={14} />
                    </button>
                  </div>
                </div>
              )}
              <div>
                <span className="notification-icon">
                  <ShieldCheck size={20} />
                </span>
                <div>
                  <strong>A safe space to try things out</strong>
                  <p>
                    You’re in demo mode. All trips, drivers, fares, and wallet
                    credits are simulated.
                  </p>
                </div>
              </div>
            </div>
          )}
        </ModalShell>
      )}
    </div>
  );
}
