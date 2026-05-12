// src/lib/smsLength.js
// SMS character counting + encoding detection.
// Matches Twilio's segmentation rules so we never get charged for
// multiple segments on a single message.

// GSM-7 basic character set (no escape needed)
// Reference: https://en.wikipedia.org/wiki/GSM_03.38
const GSM_BASIC = new Set([
  '@','£','$','¥','è','é','ù','ì','ò','Ç','\n','Ø','ø','\r','Å','å',
  'Δ','_','Φ','Γ','Λ','Ω','Π','Ψ','Σ','Θ','Ξ',
  ' ','!','"','#','¤','%','&',"'",'(',')','*','+',',','-','.','/',
  '0','1','2','3','4','5','6','7','8','9',':',';','<','=','>','?',
  '¡','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O',
  'P','Q','R','S','T','U','V','W','X','Y','Z','Ä','Ö','Ñ','Ü','§',
  '¿','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o',
  'p','q','r','s','t','u','v','w','x','y','z','ä','ö','ñ','ü','à',
])

// GSM-7 extended set (each char counts as 2)
const GSM_EXT = new Set(['^','{','}','\\','[',']','~','|','€'])

/**
 * Returns { encoding, length, segments, maxSingle, maxMulti, isOverLimit }
 *
 * @param {string} text     The message text (after variable substitution)
 * @param {number} maxSeg   Max segments allowed (default 1 = single SMS)
 */
export function analyzeSms(text, maxSeg = 1) {
  const t = text || ''
  let isGsm = true
  let gsmCount = 0

  for (const ch of t) {
    if (GSM_EXT.has(ch)) {
      gsmCount += 2
    } else if (GSM_BASIC.has(ch)) {
      gsmCount += 1
    } else {
      isGsm = false
      break
    }
  }

  if (isGsm) {
    // GSM-7: 160 single, 153 per segment in multipart
    const length = gsmCount
    let segments
    if (length <= 160) segments = length === 0 ? 0 : 1
    else segments = Math.ceil(length / 153)
    return {
      encoding: 'GSM-7',
      length,
      segments,
      maxSingle: 160,
      maxMulti: 153,
      isOverLimit: segments > maxSeg,
    }
  } else {
    // UCS-2 (Unicode): 70 single, 67 per segment in multipart
    // Note: emoji + most Chinese chars take 1 UCS-2 code unit, but
    // some emoji (e.g. flags, family) use surrogate pairs = 2 units.
    // We count code units to match Twilio.
    const length = [...t].reduce((n, ch) => {
      const cp = ch.codePointAt(0)
      return n + (cp > 0xFFFF ? 2 : 1)
    }, 0)
    let segments
    if (length <= 70) segments = length === 0 ? 0 : 1
    else segments = Math.ceil(length / 67)
    return {
      encoding: 'UCS-2',
      length,
      segments,
      maxSingle: 70,
      maxMulti: 67,
      isOverLimit: segments > maxSeg,
    }
  }
}

/**
 * Render a template with variables substituted. Variables use the
 * {name} syntax. Missing values render as empty string so the count
 * is always realistic.
 */
export function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{(\w+)\}/g, (_, key) => {
    const v = vars[key]
    if (v == null) return ''
    return String(v)
  })
}

/**
 * Build a sample variable bag for previewing each trigger template.
 * Uses realistic-ish values so character counts match production.
 */
export const SAMPLE_VARS = {
  store:    'Sample Store',
  name:     'John Smith',
  order:    '#A1B2C3',
  invoice:  '#INV-1042',
  amt:      '42.50',
  date:     'May 31',
  link:     'rpos.co/r/A1B2',  // assume short link ~14 chars
  code:     'BDAY10',
  pct:      '10',
  pts:      '1250',
  employee: 'Alice',
}

/**
 * Convenience — give back the segment color for a UI badge.
 * 'safe' (1 seg, lots of room) / 'tight' (1 seg, near max) / 'over' (>1 seg).
 */
export function segmentStatus(analysis, maxSeg = 1) {
  if (analysis.isOverLimit) return 'over'
  if (analysis.segments === 0) return 'safe'
  const tightThreshold = analysis.encoding === 'GSM-7' ? 140 : 60
  if (analysis.length >= tightThreshold) return 'tight'
  return 'safe'
}
