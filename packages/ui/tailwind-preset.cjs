/** Shared Tailwind preset: maps utilities onto the CSS-variable tokens. */
const c = (v) => `rgb(var(--wd-${v}) / <alpha-value>)`;
module.exports = {
  theme: {
    extend: {
      colors: {
        navy: c('navy'), 'navy-2': c('navy-2'), teal: c('teal'), 'teal-ink': c('teal-ink'),
        paper: c('paper'), surface: c('surface'), line: c('line'), ink: c('ink'), muted: c('muted'),
        amber: c('amber'), 'amber-ink': c('amber-ink'), danger: c('red'), ok: c('green'), focus: c('focus'),
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      borderRadius: { s: 'var(--wd-radius-s)', m: 'var(--wd-radius-m)' },
      fontSize: {
        // modular scale ~1.2 on 16px
        xs: ['0.75rem', '1.1rem'], sm: ['0.875rem', '1.35rem'], base: ['1rem', '1.55rem'],
        lg: ['1.2rem', '1.7rem'], xl: ['1.44rem', '1.9rem'], '2xl': ['1.728rem', '2.15rem'], '3xl': ['2.488rem', '2.8rem'],
      },
    },
  },
};
