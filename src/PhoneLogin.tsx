import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  LoaderCircle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { api, type User } from "./api";

type Challenge = {
  challenge_id: string;
  phone: string;
  mode: string;
  development_code: string | null;
  expires_in: number;
  resend_after: number;
};
export default function PhoneLogin({
  onSuccess,
}: {
  onSuccess: (user: User) => Promise<void>;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [mode, setMode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    api<{ phone_auth_mode: string }>("/config")
      .then((c) => setMode(c.phone_auth_mode))
      .catch(() => setMode("disabled"));
  }, []);
  useEffect(() => {
    const timer = setInterval(
      () =>
        setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000))),
      1000,
    );
    return () => clearInterval(timer);
  }, [resendAt]);
  const request = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await api<Challenge>("/auth/phone/request", "POST", {
        phone,
      });
      setChallenge(result);
      setCode("");
      setResendAt(Date.now() + result.resend_after * 1000);
      setRemaining(result.resend_after);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      const user = await api<User>("/auth/phone/verify", "POST", {
        challenge_id: challenge.challenge_id,
        code,
        name: name.trim() || "Roam Rider",
      });
      await onSuccess(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="phone-login">
      {mode === "development" && (
        <div className="development-auth-note">
          <ShieldCheck size={18} />
          <span>
            <strong>Development phone login</strong>No SMS is sent. A one-time
            test code is shown here. This does not verify ownership of a real
            number.
          </span>
        </div>
      )}
      {mode === "disabled" && (
        <div className="error-message">
          Phone login is disabled on this server. You can still use email
          sign-in.
        </div>
      )}
      {!challenge ? (
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault();
            void request();
          }}
        >
          <p className="modal-description">
            A six-digit code. A simple way to get moving.
          </p>
          <label htmlFor="phone-name">
            Your name <small>(optional)</small>
            <input
              id="phone-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="What should we call you?"
              maxLength={60}
            />
          </label>
          <label htmlFor="login-phone">
            Mobile number
            <div className="phone-number-input">
              <span>+91</span>
              <input
                id="login-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                placeholder="10-digit mobile number"
                pattern="[6-9][0-9]{9}"
                maxLength={10}
                required
              />
            </div>
          </label>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <button
            className="primary"
            disabled={busy || !mode || mode === "disabled"}
          >
            {busy
              ? "Requesting code…"
              : mode === "development"
                ? "Get test code"
                : "Send SMS code"}
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Smartphone size={17} />
            )}
          </button>
        </form>
      ) : (
        <form className="modal-form" onSubmit={verify}>
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setChallenge(null);
              setError("");
            }}
          >
            <ArrowLeft size={14} />
            Change number
          </button>
          <p className="modal-description">
            Enter the code for <strong>{challenge.phone}</strong>. It expires in
            5 minutes.
          </p>
          {challenge.development_code && (
            <div className="development-code">
              <span>YOUR ONE-TIME DEVELOPMENT CODE</span>
              <strong>{challenge.development_code}</strong>
              <small>Test mode · not an SMS</small>
            </div>
          )}
          <label htmlFor="phone-code">
            Verification code
            <input
              id="phone-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
            />
          </label>
          {error && (
            <div className="error-message" role="alert">
              {error}
            </div>
          )}
          <button className="primary" disabled={busy}>
            {busy ? "Verifying…" : "Verify & continue"}
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Check size={17} />
            )}
          </button>
          <button
            type="button"
            className="text-button centered"
            disabled={busy || remaining > 0}
            onClick={() => void request()}
          >
            {remaining ? (
              `Request a new code in ${remaining}s`
            ) : (
              <>
                Request a new code
                <ArrowRight size={14} />
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}
