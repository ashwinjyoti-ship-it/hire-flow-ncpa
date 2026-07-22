import type { Config } from "tailwindcss";

/**
 * Marble + Sage design system tokens.
 * Source: Ivory Calendar Mockup Design.md (verbatim hex/spacing/radii).
 * Status overlay: docx §5.2 + design-sheet PNG pixel sampling.
 */
export default {
  content: ["./src/**/*.{ts,tsx}", "./index.html"],
  theme: {
    extend: {
      // First custom screen in the project: the Organisations faceted panel
      // collapses its filter rail into a drawer below this width.
      screens: {
        bp: "900px",
      },
      colors: {
        // Marble base tones
        marble: {
          base: "rgb(var(--marble-base) / <alpha-value>)",
          highlight: "rgb(var(--marble-highlight) / <alpha-value>)",
          shadow: "rgb(var(--marble-shadow) / <alpha-value>)",
          btnLight: "rgb(var(--marble-btn-light) / <alpha-value>)",
          btnDark: "rgb(var(--marble-btn-dark) / <alpha-value>)",
          btnHoverLight: "rgb(var(--marble-btn-hover-light) / <alpha-value>)",
          btnHoverDark: "rgb(var(--marble-btn-hover-dark) / <alpha-value>)",
        },
        // Sage accent family (primary chromatic accent)
        sage: {
          DEFAULT: "rgb(var(--sage) / <alpha-value>)",
          dark: "rgb(var(--sage-dark) / <alpha-value>)",
          text: "rgb(var(--sage-text) / <alpha-value>)",
          eventText: "#5D6A4A",
          label: "#9CAF88",
          upnext: "#93A17D",
          btnLight: "#EEF2E7",
          btnDark: "#DCE4CF",
          btnHoverLight: "#F2F5EC",
          btnHoverDark: "#E1E8D6",
        },
        // Deep Terracotta — the single warm accent. Reserved for primary
        // CTAs, active/selected states, key icons, and small highlights.
        // Never for status or priority indicators (those keep `status.*`).
        terracotta: {
          DEFAULT: "rgb(var(--terracotta) / <alpha-value>)",
          dark: "rgb(var(--terracotta-dark) / <alpha-value>)",
          text: "rgb(var(--terracotta-text) / <alpha-value>)",
          btnLight: "#F6E7DF",
          btnDark: "#EDD5C8",
          btnHoverLight: "#F9EDE7",
          btnHoverDark: "#F1DCD1",
        },
        // Text hierarchy
        ink: {
          primary: "rgb(var(--ink-primary) / <alpha-value>)",
          secondary: "rgb(var(--ink-secondary) / <alpha-value>)",
          tertiary: "rgb(var(--ink-tertiary) / <alpha-value>)",
          muted: "rgb(var(--ink-muted) / <alpha-value>)",
          dayHeader: "rgb(var(--ink-day-header) / <alpha-value>)",
          sidebarMuted: "rgb(var(--ink-sidebar-muted) / <alpha-value>)",
          overflow: "rgb(var(--ink-overflow) / <alpha-value>)",
        },
        // Event dot palette (neutral categories)
        dot: {
          personal: "#9CAF88",
          work: "#B0AAA0",
          family: "#C9C3B8",
        },
        // Status overlay (data-semantic; applied to small dots/pills/labels ONLY)
        status: {
          enquiry: "#B0AAA0", // muted blue-grey (was 'inquiry')
          tentative: "#EB9651", // muted orange
          approved: "#8FA079", // deeper soft sage (VFH gate)
          confirmed: "#9CAF88", // sage green
          regret: "#C797BB", // muted magenta (declined enquiry)
          cancelled: "#E0857B", // muted red (booking called off)
          // Legacy aliases retained for any leftover references:
          inquiry: "#B0AAA0",
          availability: "#7DA9B8",
          awaitingApproval: "#EDC47F",
          waitlisted: "#B4A0E7",
          inProgress: "#7FAEAB",
          completed: "#726F68",
          closed: "#A8A29A",
          rejected: "#C797BB",
          draft: "#C3BFB6",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      fontSize: {
        // Type scale (verbatim from design.md §3)
        "2xs": ["10px", { lineHeight: "1.2" }],
        xxs: ["11px", { lineHeight: "1.3" }],
      },
      letterSpacing: {
        wider2: "0.2em",
      },
      spacing: {
        // Explicit scale used by the mockup
        "1.5": "6px",
      },
      borderRadius: {
        // Verbatim radii
        xl: "12px",
        "2xl": "16px",
        md: "6px",
        lg: "8px",
      },
      boxShadow: {
        // Inset-only depth system. No outer shadows except the 1px button shadow.
        carved: "inset 0 2px 5px rgba(90,88,82,0.20), inset 0 8px 16px rgba(90,88,82,0.08), inset 2px 0 6px rgba(90,88,82,0.09), inset 0 -1px 0 rgba(255,255,255,0.85), inset -1px 0 0 rgba(255,255,255,0.6)",
        "carved-today": "inset 0 2px 5px rgba(90,88,82,0.18), inset 0 8px 16px rgba(90,88,82,0.08), inset 0 0 0 1.5px rgba(156,175,136,0.55), inset 0 -1px 0 rgba(255,255,255,0.85)",
        "carved-card": "inset 0 2px 5px rgba(90,88,82,0.16), inset 0 -1px 0 rgba(255,255,255,0.9)",
        "carved-header": "inset 0 2px 5px rgba(90,88,82,0.16), inset 0 -1px 0 rgba(255,255,255,0.9)",
        "carved-btn": "0 1px 2px rgba(90,88,82,0.16), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 2px rgba(90,88,82,0.10)",
        "carved-btn-sage": "0 1px 2px rgba(90,88,82,0.16), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 2px rgba(110,125,95,0.14)",
        "carved-btn-terracotta": "0 1px 2px rgba(90,88,82,0.16), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 2px rgba(150,80,50,0.16)",
        "sage-pip": "inset 0 1px 1px rgba(255,255,255,0.5), 0 1px 2px rgba(110,125,95,0.25)",
        "terracotta-pip": "inset 0 1px 1px rgba(255,255,255,0.5), 0 1px 2px rgba(150,80,50,0.28)",
        "evt-dot": "0 1px 1px rgba(90,88,82,0.18)",
      },
      textColor: {
        // For the carved text-shadow utilities below
        etched: "#5C5850",
      },
      backgroundImage: {
        "marble-stage":
          "radial-gradient(160% 130% at 18% -5%, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 50%), linear-gradient(155deg, #FEFEFE 0%, #FAFAF8 55%, #F4F4F2 100%)",
        "sage-today-wash":
          "linear-gradient(180deg, rgba(140,157,120,0.16) 0%, rgba(140,157,120,0.05) 100%)",
        "sage-btn": "linear-gradient(180deg, #EEF2E7 0%, #DCE4CF 100%)",
        "sage-btn-hover": "linear-gradient(180deg, #F2F5EC 0%, #E1E8D6 100%)",
        "terracotta-btn": "linear-gradient(180deg, #F6E7DF 0%, #EDD5C8 100%)",
        "terracotta-btn-hover": "linear-gradient(180deg, #F9EDE7 0%, #F1DCD1 100%)",
        "neutral-btn": "linear-gradient(180deg, #FCFCFB 0%, #F1F1EF 100%)",
        "neutral-btn-hover": "linear-gradient(180deg, #FFFFFF 0%, #F5F5F3 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
