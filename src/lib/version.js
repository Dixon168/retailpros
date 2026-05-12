// src/lib/version.js
// Centralized place for software branding. Update APP_VERSION here
// (and in package.json) before each release.

import pkg from '../../package.json'

export const APP_NAME      = 'RetailPOS'
export const APP_VERSION   = pkg.version
export const APP_TAGLINE   = 'Modern POS for Modern Retail'
export const APP_COPYRIGHT = `© ${new Date().getFullYear()} ${APP_NAME}`

// "RetailPOS v1.0.0" — used in footers
export const APP_VERSION_LABEL = `${APP_NAME} v${APP_VERSION}`
