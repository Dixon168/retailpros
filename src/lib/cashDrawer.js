// src/lib/cashDrawer.js
// Open the cash drawer connected to the receipt printer.
//
// HOW IT WORKS
// Most thermal receipt printers have a DK port (RJ11/RJ12) on the back
// that drives a cash drawer's solenoid. When the printer receives a
// specific ESC/POS escape sequence in the print stream, it fires the
// solenoid and the drawer pops open.
//
// The standard ESC/POS "open drawer 1" command is: ESC p 0 25 250
//   ESC = 0x1B, p = 0x70, m = 0x00, t1 = 0x19, t2 = 0xFA
//
// Since we can't write raw bytes to the printer from a browser, we
// instead emit a tiny "print job" that consists of just the escape
// sequence wrapped in a hidden iframe → window.print(). The browser
// passes our content to the Windows printer driver, which forwards
// the bytes to the printer, which sees the escape code and kicks the
// drawer open. The print job itself produces no visible paper output
// because there's no actual content — just the control sequence.
//
// CAVEATS
// - Only works when the drawer is wired into the receipt printer.
//   Standalone USB cash drawers can't be controlled from a browser
//   without a native helper app.
// - Some printer drivers strip escape sequences. If that happens you
//   may need to use a different "raw passthrough" print driver in
//   Windows. We document this in the Settings page.
// - First time the user prints, they'll see the same "pick printer"
//   dialog as for receipts. After they pick once and set as default,
//   future drawer kicks are silent.

const DEFAULT_DRAWER = {
  enabled:        false,
  method:         'printer',   // 'printer' | 'manual'
  open_on_cash:   true,        // auto-open after cash payment
  open_on_refund: true,        // auto-open after cash refund
  // ESC/POS command bytes (most printers respect ESC p 0 25 250).
  // Some need ESC p 0 50 50 instead — exposed for advanced users.
  command_t1:     25,
  command_t2:     250,
}

export function getCashDrawerSettings() {
  try {
    const v = localStorage.getItem('cashDrawerSettings')
    return v ? { ...DEFAULT_DRAWER, ...JSON.parse(v) } : DEFAULT_DRAWER
  } catch {
    return DEFAULT_DRAWER
  }
}

export function saveCashDrawerSettings(s) {
  localStorage.setItem('cashDrawerSettings', JSON.stringify(s))
}

/**
 * Send the open-drawer escape sequence through the receipt printer.
 *
 * @returns {Promise<{ok: boolean, msg: string}>}
 */
export function openCashDrawer() {
  return new Promise(resolve => {
    const s = getCashDrawerSettings()
    if (!s.enabled) {
      resolve({ ok: false, msg: 'Cash drawer is disabled in Settings' })
      return
    }
    if (s.method !== 'printer') {
      resolve({ ok: false, msg: 'Only printer-driven drawers are supported' })
      return
    }

    // Build the ESC/POS escape sequence as a string.
    // String.fromCharCode lets us embed the raw bytes; the printer
    // driver should pass these through unchanged.
    const ESC = String.fromCharCode(0x1B)
    const p   = 'p'              // 0x70
    const m   = String.fromCharCode(0x00)
    const t1  = String.fromCharCode(Number(s.command_t1) || 25)
    const t2  = String.fromCharCode(Number(s.command_t2) || 250)
    const drawerCmd = ESC + p + m + t1 + t2

    // Tiny invisible print job. The body is just the escape sequence;
    // we wrap it in <pre> so the browser doesn't reflow / strip it.
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <title>Drawer</title>
      <style>@page{margin:0;size:80mm auto;} body{margin:0;padding:0;font-family:monospace;font-size:1px;color:transparent;}</style>
      </head><body><pre>${drawerCmd}</pre></body></html>`

    const iframe = document.createElement('iframe')
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
    document.body.appendChild(iframe)
    const doc = iframe.contentDocument || iframe.contentWindow.document
    doc.open(); doc.write(html); doc.close()
    iframe.contentWindow.focus()

    setTimeout(() => {
      try {
        iframe.contentWindow.print()
        resolve({ ok: true, msg: 'Drawer opened' })
      } catch (e) {
        resolve({ ok: false, msg: e.message || 'Print call failed' })
      }
      setTimeout(() => { try { document.body.removeChild(iframe) } catch {} }, 1500)
    }, 200)
  })
}
