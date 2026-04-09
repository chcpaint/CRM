/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fff1f1',
          100: '#ffe1e1',
          200: '#ffc7c7',
          300: '#ffa0a0',
          400: '#ff6b6b',
          500: '#e63946',
          600: '#c1121f',
          700: '#a3111a',
          800: '#871419',
          900: '#72161b',
        },
        navy: {
          50: '#f0f3f8',
          100: '#dae1ec',
          200: '#bcc8dc',
          300: '#94a7c4',
          400: '#6e84a8',
          500: '#53698e',
          600: '#435476',
          700: '#384562',
          800: '#1e2a3f',
          900: '#0d1b2a',
          950: '#070f1a',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(13, 27, 42, 0.18)',
        'glass-sm': '0 4px 16px 0 rgba(13, 27, 42, 0.12)',
        'glow-red': '0 0 20px rgba(230, 57, 70, 0.3)',
        'glow-blue': '0 0 20px rgba(13, 27, 42, 0.4)',
        'card': '0 1px 3px rgba(13, 27, 42, 0.06), 0 6px 16px rgba(13, 27, 42, 0.06)',
        'card-hover': '0 4px 12px rgba(13, 27, 42, 0.1), 0 12px 32px rgba(13, 27, 42, 0.1)',
        'inset-glow': 'inset 0 1px 0 0 rgba(255,255,255,0.1)',
      },
      backgroundImage: {
        'glass-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
        'hero-gradient': 'linear-gradient(135deg, #0d1b2a 0%, #1e2a3f 50%, #0d1b2a 100%)',
        'sidebar-gradient': 'linear-gradient(180deg, #ffffff 0%, #f0f3f8 100%)',
        'brand-gradient': 'linear-gradient(135deg, #e63946 0%, #c1121f 100%)',
        'navy-gradient': 'linear-gradient(135deg, #1e2a3f 0%, #0d1b2a 100%)',
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.4s ease-out',
        'fade-in-down': 'fadeInDown 0.3s ease-out',
        'slide-in-left': 'slideInLeft 0.3s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'shimmer': 'shimmer 2s infinite linear',
        'float': 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInDown: {
          '0%': { opacity: '0', transform: 'translateY(-12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInLeft: {
          '0%': { opacity: '0', transform: 'translateX(-20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(20px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
      },
      transitionTimingFunction: {
        'bounce-in': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
