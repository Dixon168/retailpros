// src/lib/displaySync.js
// Sync cart + customer + payment state between POS tab and Customer Display tab.
// Uses BroadcastChannel which is free, zero-latency, and same-origin only —
// perfect for a second-monitor setup where both screens are the same browser.
//
// CHANNEL name is per-terminal so multiple terminals on the same network won't
// cross-talk. Falls back to localStorage events if BroadcastChannel isn't
// available (older browsers).

const CHANNEL_PREFIX = 'rpos-display-'

// Event names exchanged between POS ⇄ Display
export const EVT = {
  // POS → Display
  CART_STATE:      'cart_state',       // {items, customer, totals, orderDiscount, ...}
  PAYMENT_OPEN:    'payment_open',     // payment panel just opened
  PAYMENT_CLOSE:   'payment_close',
  REQUEST_TIP:     'request_tip',      // ask customer to pick tip
  REQUEST_SIG:     'request_sig',      // ask for signature
  REQUEST_CONTACT: 'request_contact',  // ask for email/sms
  ORDER_DONE:      'order_done',       // payment complete
  DISPLAY_PING:    'display_ping',     // POS asking 'are you there?'

  // Display → POS
  TIP_SELECTED:    'tip_selected',     // customer picked tip amount
  SIG_COMPLETE:    'sig_complete',     // signature captured
  CONTACT_ENTERED: 'contact_entered',  // email/sms entered
  DISPLAY_HELLO:   'display_hello',    // Display announcing it's open
  LANG_CHANGED:    'lang_changed',     // customer switched language on display
}

class DisplaySync {
  constructor(terminalId) {
    this.terminalId = terminalId || 'default'
    this.channel = null
    this.listeners = new Map()  // event → Set<callback>
    this.lastState = null       // last published cart state, replayed to new subscribers

    try {
      this.channel = new BroadcastChannel(CHANNEL_PREFIX + this.terminalId)
      this.channel.onmessage = (e) => this._dispatch(e.data)
    } catch (err) {
      console.warn('[displaySync] BroadcastChannel unavailable, falling back to storage', err)
      // Fallback: storage event
      window.addEventListener('storage', (e) => {
        if (e.key === CHANNEL_PREFIX + this.terminalId && e.newValue) {
          try { this._dispatch(JSON.parse(e.newValue)) } catch {}
        }
      })
    }
  }

  publish(event, data) {
    const msg = { event, data, t: Date.now() }
    if (event === EVT.CART_STATE) this.lastState = msg

    if (this.channel) {
      try { this.channel.postMessage(msg) } catch (err) { console.warn('[displaySync] publish failed', err) }
    } else {
      // Storage fallback: write a unique payload so other tabs see the change
      try {
        localStorage.setItem(CHANNEL_PREFIX + this.terminalId, JSON.stringify(msg))
        localStorage.removeItem(CHANNEL_PREFIX + this.terminalId)
      } catch {}
    }
  }

  subscribe(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  _dispatch(msg) {
    if (!msg || !msg.event) return
    const set = this.listeners.get(msg.event)
    if (set) set.forEach(cb => { try { cb(msg.data, msg) } catch (err) { console.error(err) } })
  }

  // Returns the last cart state we saw (for late-joining Display tab)
  getLastState() {
    return this.lastState?.data
  }

  destroy() {
    try { this.channel?.close() } catch {}
    this.listeners.clear()
  }
}

// Singleton per terminal (the page only ever talks to one display at a time)
let _instance = null
export function getDisplaySync(terminalId) {
  if (!_instance || _instance.terminalId !== terminalId) {
    _instance?.destroy()
    _instance = new DisplaySync(terminalId)
  }
  return _instance
}
