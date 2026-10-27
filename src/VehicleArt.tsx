export default function VehicleArt({
  type,
  className = "",
}: {
  type: string;
  className?: string;
}) {
  return (
    <svg
      className={`vehicle-art ${className}`}
      viewBox="0 0 120 75"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="61" cy="64" rx="43" ry="5" fill="#222" opacity=".08" />
      {type === "bike" ? (
        <>
          <circle cx="30" cy="56" r="12" fill="#34383C" />
          <circle cx="30" cy="56" r="7" fill="#BEC5C7" />
          <circle cx="88" cy="56" r="12" fill="#34383C" />
          <circle cx="88" cy="56" r="7" fill="#BEC5C7" />
          <path
            d="M28 53L43 30h20l10 21H41z"
            fill="#EEEAE2"
            stroke="#949A98"
            strokeWidth="1.5"
          />
          <path
            d="M48 34l-6 18h29l9-24h9l-5 24"
            stroke="#8B9394"
            strokeWidth="4"
          />
          <path d="M82 20l6 36" stroke="#555D5F" strokeWidth="3" />
          <path
            d="M78 20h10l4 5"
            stroke="#34383C"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <path
            d="M43 29h22"
            stroke="#333D40"
            strokeWidth="7"
            strokeLinecap="round"
          />
          <path d="M22 46h16l8-11H33z" fill="#C6D2CE" />
          <path d="M72 35h12l-4 14H66z" fill="#E0E8E4" />
          <rect x="88" y="29" width="6" height="8" rx="3" fill="#F8D889" />
        </>
      ) : type === "auto" ? (
        <>
          <path d="M22 31q0-11 11-11h41q8 0 12 10l13 24H21z" fill="#E6BA37" />
          <path d="M23 33h52l11 21H22z" fill="#3D7F67" />
          <path d="M76 24l12 21H75V24z" fill="#CAD8D0" />
          <path d="M28 26h17v20H28z" fill="#293D3B" />
          <path d="M50 26h17v20H50z" fill="#CBD9C9" />
          <path d="M45 23v29M69 23v29" stroke="#D2AD34" strokeWidth="3" />
          <rect x="19" y="50" width="81" height="10" rx="4" fill="#38735E" />
          <circle cx="34" cy="58" r="10" fill="#303938" />
          <circle cx="34" cy="58" r="5" fill="#B9C8BF" />
          <circle cx="84" cy="58" r="10" fill="#303938" />
          <circle cx="84" cy="58" r="5" fill="#B9C8BF" />
          <rect x="93" y="45" width="6" height="7" rx="2" fill="#FFEBBA" />
        </>
      ) : (
        <>
          <path
            d={
              type === "sedan"
                ? "M13 45l15-5 14-20h34l18 21 17 6v12H12z"
                : "M14 43l17-4 11-20h33l13 21 17 7v12H13z"
            }
            fill={type === "sedan" ? "#C2CBD6" : "#E6E8E7"}
            stroke="#929C9F"
            strokeWidth="1"
          />
          <path d="M37 38l10-15h12v15H37zM63 23h10l12 15H63z" fill="#485D67" />
          <path
            d="M47 24h9l-9 13h-8zM65 24h6l10 13h-8z"
            fill="#81979F"
            opacity=".65"
          />
          <path d="M19 46h12v5H17z" fill="#EDB998" />
          <path d="M95 45h10v6H95z" fill="#FFF6CF" />
          <path d="M39 42v11M61 41v13M87 42v12" stroke="#AAB3B5" />
          <path
            d="M54 44h4M77 44h4"
            stroke="#758083"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="34" cy="57" r="11" fill="#30383C" />
          <circle cx="34" cy="57" r="6" fill="#ABB5B7" />
          <circle cx="88" cy="57" r="11" fill="#30383C" />
          <circle cx="88" cy="57" r="6" fill="#ABB5B7" />
          <path d="M17 58h6M100 57h6" stroke="#7D888C" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
