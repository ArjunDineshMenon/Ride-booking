export type Place = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: string;
  city?: string;
  state?: string;
};
export type Vehicle = {
  id: string;
  name: string;
  tagline: string;
  seats: number;
  eta: number;
  badge: string;
  fare: number;
  subtotal: number;
  discount: number;
  available: boolean;
  unavailable_reason: string;
  per_km: number;
  per_minute: number;
  breakdown: Record<string, number>;
};
export type User = {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  wallet: number;
  demo: number;
};
export type Quote = {
  id: string;
  pickup: Place;
  dropoff: Place;
  distance: number;
  duration: number;
  vehicles: Vehicle[];
  promo: string;
  route: RoadRoute;
  pricing: Pricing;
};
export type RoadRoute = {
  distance: number;
  duration: number;
  geometry: [number, number][];
  source: "osrm" | "estimate";
  warning: string | null;
};
export type Pricing = {
  zone: string;
  trip_type: string;
  version: string;
  notice: string;
};
export type Ride = {
  id: string;
  pickup: Place;
  dropoff: Place;
  distance: number;
  duration: number;
  vehicle: Vehicle;
  fare: number;
  status: string;
  payment: string;
  created_at: number;
  scheduled_at: string | null;
  pin: string;
  rating: number | null;
  route?: RoadRoute;
  pricing?: Pricing;
  driver: {
    name: string;
    rating: number;
    trips: number;
    plate: string;
    vehicle: string;
  };
};
export type Saved = { id: string; label: string; place: Place };
export type WalletData = {
  balance: number;
  transactions: {
    id: string;
    amount: number;
    description: string;
    created: number;
  }[];
};
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(
      "Cannot reach Roam. Check that the Python backend is running.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : data.detail?.[0]?.msg || "Something went wrong. Please try again.",
    );
  }
  return response.json();
}
export const money = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
export const date = (value: number | string) =>
  new Date(typeof value === "number" ? value * 1000 : value).toLocaleString(
    "en-IN",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
  );
