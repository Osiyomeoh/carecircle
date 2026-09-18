/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Living-room breakpoints, for the places a rem scale is not enough.
      screens: { tv: '1920px', tv4k: '3200px' },
      colors: {
        bg: '#07090f',
        panel: 'rgba(18,22,33,0.72)',
        ink: '#eef2fb',
        muted: '#8b93a7',
        line: 'rgba(255,255,255,0.08)',
        // provenance
        confirmed: '#7cf0c8',
        inferred: '#b46bff',
        norecord: '#ffb020',
        core: '#7cf0c8',
        // surfaces / devices
        alexa: '#4ea1ff',
        ring: '#25d3c2',
        bee: '#ffb020',
        tv: '#b46bff',
        // severity
        sevHigh: '#ff5d6c',
        sevMed: '#ffb020',
        sevLow: '#7cf0c8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 10px 40px rgba(124,240,200,0.28)',
        card: '0 8px 30px rgba(0,0,0,0.35)',
      },
      keyframes: {
        beat: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.3' } },
        floaty: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        rise: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        driftSlow: { '0%,100%': { transform: 'translate(0,0)' }, '50%': { transform: 'translate(6vw,4vh)' } },
        driftSlower: { '0%,100%': { transform: 'translate(0,0)' }, '50%': { transform: 'translate(-5vw,-3vh)' } },
        // The orb at rest: alive enough to look tappable, slow enough to ignore.
        breath: { '0%,100%': { transform: 'scale(1)', opacity: '0.85' }, '50%': { transform: 'scale(1.05)', opacity: '1' } },
        // A ring leaving the orb while it listens.
        ripple: { '0%': { transform: 'scale(0.85)', opacity: '0.55' }, '100%': { transform: 'scale(1.9)', opacity: '0' } },
      },
      animation: {
        beat: 'beat 1.8s infinite',
        floaty: 'floaty 5s ease-in-out infinite',
        rise: 'rise 0.5s ease-out both',
        'drift-slow': 'driftSlow 26s ease-in-out infinite',
        'drift-slower': 'driftSlower 34s ease-in-out infinite',
        breath: 'breath 3.4s ease-in-out infinite',
        ripple: 'ripple 1.8s ease-out infinite',
      },
    },
  },
  plugins: [],
};
