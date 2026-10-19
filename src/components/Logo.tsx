export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="logo-mark"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#29f0ff" />
          <stop offset="100%" stopColor="#ff2bd6" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L28 9 L28 23 L16 30 L4 23 L4 9 Z"
        fill="none"
        stroke="url(#logo-grad)"
        strokeWidth="2"
      />
      <path
        d="M11 12 h10 M11 16 h6 M11 20 h10"
        stroke="url(#logo-grad)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="21" cy="16" r="2" fill="#29f0ff" />
    </svg>
  );
}

export function Logo() {
  return (
    <div className="brand" aria-label="PortControl" data-tauri-drag-region>
      <LogoMark />
      <span className="brand-name" data-tauri-drag-region>
        PORT<em>//</em>CONTROL
      </span>
    </div>
  );
}
