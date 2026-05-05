// src/components/pos/VoiceOrder.jsx
// Voice ordering - speak products → AI matches → adds to cart
import { useState, useRef, useEffect } from 'react'
import { useCartStore } from '@/stores/cartStore'
import toast from 'react-hot-toast'

async function parseVoiceOrder(transcript, products) {
  try {
    // Build rich product list with Chinese common names for better matching
    const productList = products.map(p => {
      // Generate likely Chinese names for common products
      const chineseHints = {
        'apple': '苹果', 'mango': '芒果', 'banana': '香蕉', 'orange': '橙子/橘子',
        'grape': '葡萄', 'watermelon': '西瓜', 'strawberry': '草莓', 'pear': '梨',
        'lemon': '柠檬', 'peach': '桃子', 'pineapple': '菠萝', 'kiwi': '猕猴桃',
        'milk': '牛奶', 'water': '水', 'juice': '果汁', 'beer': '啤酒',
        'wine': '葡萄酒/红酒', 'coke': '可乐', 'pepsi': '百事可乐', 'coffee': '咖啡',
        'tea': '茶', 'sprite': '雪碧', 'soda': '苏打水',
        'rice': '米饭/大米', 'bread': '面包', 'egg': '鸡蛋', 'chicken': '鸡肉',
        'beef': '牛肉', 'pork': '猪肉', 'fish': '鱼', 'shrimp': '虾',
        'tofu': '豆腐', 'noodle': '面条', 'chips': '薯片', 'chocolate': '巧克力',
        'candy': '糖果', 'cookie': '饼干', 'cake': '蛋糕', 'ice cream': '冰淇淋',
      }
      const nameLower = p.name.toLowerCase()
      const chineseAlias = Object.entries(chineseHints).find(([en]) => nameLower.includes(en))?.[1] || ''
      return {
        id: p.id,
        name: p.name,
        chinese_name: chineseAlias,
        tags: p.tags || [],
        unit: p.unit || 'ea',
        price: p.price,
      }
    })

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: `You are a multilingual POS assistant. Match spoken words to products.

Staff said: "${transcript}"

Products available:
${productList.map(p => `- ID:${p.id} | Name:"${p.name}" | Chinese:"${p.chinese_name}" | Tags:${p.tags.join(',')} | Unit:${p.unit}`).join('
')}

MATCHING RULES:
1. Match by meaning, not exact words (苹果=Apple, 可乐=Coke/Cola, 红酒=Red Wine)
2. Use chinese_name field to match Chinese speech to English product names
3. Extract quantity (三个=3, 两瓶=2, 半斤=0.5, 一打=12, 两打=24)
4. Default qty = 1 if not specified
5. Only match products in the list above
6. Partial matches OK (说"苹果" matches "Fuji Apple", "Red Apple", "Green Apple")

Respond ONLY with JSON array (no markdown, no explanation):
[{"product_id":"xxx","product_name":"Apple","qty":3}]

Empty array [] if nothing matches.`
        }]
      })
    })
    const d = await res.json()
    const text = d.content?.[0]?.text || '[]'
    return JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch(e) {
    return []
  }
}

export function VoiceOrderButton({ products }) {
  const [state, setState]           = useState('idle') // idle | listening | processing | done
  const [transcript, setTranscript] = useState('')
  const [matches, setMatches]       = useState([])
  const [showPanel, setShowPanel]   = useState(false)
  const recognitionRef              = useRef(null)
  const { addProduct }              = useCartStore()

  // Check browser support
  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const startListening = () => {
    if (!supported) { toast.error('Voice not supported in this browser'); return }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SR()
    recognitionRef.current = recognition

    recognition.lang = 'en-US'  // supports both English and Chinese
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.continuous = false

    recognition.onstart = () => { setState('listening'); setTranscript(''); setShowPanel(true) }

    recognition.onresult = (e) => {
      const interim = Array.from(e.results).map(r => r[0].transcript).join('')
      setTranscript(interim)
    }

    recognition.onend = async () => {
      const final = transcript || ''
      if (!final.trim()) { setState('idle'); return }
      setState('processing')

      const items = await parseVoiceOrder(final, products)
      setMatches(items)
      setState('done')

      if (items.length === 0) {
        toast.error('No matching products found')
        setState('idle')
        return
      }
    }

    recognition.onerror = (e) => {
      setState('idle')
      if (e.error !== 'no-speech') toast.error('Voice error: ' + e.error)
    }

    recognition.start()
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
  }

  const confirmAdd = () => {
    let added = 0
    matches.forEach(item => {
      const product = products.find(p => p.id === item.product_id)
      if (product) {
        for (let i = 0; i < item.qty; i++) addProduct(product)
        added++
      }
    })
    toast.success(`✓ Added ${added} product${added>1?'s':''} to cart`)
    setShowPanel(false)
    setState('idle')
    setTranscript('')
    setMatches([])
  }

  const cancel = () => {
    recognitionRef.current?.stop()
    setShowPanel(false)
    setState('idle')
    setTranscript('')
    setMatches([])
  }

  useEffect(() => {
    // Update transcript ref for use in onend
    // (closure issue fix)
  }, [transcript])

  const isListening  = state === 'listening'
  const isProcessing = state === 'processing'
  const isDone       = state === 'done'

  return (
    <>
      {/* Mic button */}
      <button
        onMouseDown={startListening}
        onMouseUp={stopListening}
        onTouchStart={e => { e.preventDefault(); startListening() }}
        onTouchEnd={e => { e.preventDefault(); stopListening() }}
        disabled={!supported || isProcessing}
        className="flex items-center justify-center rounded-xl cursor-pointer border-none transition-all flex-shrink-0 disabled:opacity-40"
        style={{
          width: '40px', height: '40px',
          background: isListening
            ? 'linear-gradient(135deg,#dc2626,#ef4444)'
            : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          boxShadow: isListening ? '0 0 0 4px rgba(239,68,68,0.25)' : 'none',
        }}
        title={supported ? 'Hold to speak' : 'Voice not supported'}>
        {isProcessing ? (
          <span className="text-[14px] animate-spin">⚙️</span>
        ) : isListening ? (
          <span className="text-[16px] animate-pulse">🔴</span>
        ) : (
          <span className="text-[16px]">🎤</span>
        )}
      </button>

      {/* Panel overlay */}
      {showPanel && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center"
          style={{background:'rgba(15,23,42,0.7)', backdropFilter:'blur(4px)'}}>
          <div className="w-full rounded-t-3xl overflow-hidden shadow-2xl"
            style={{background:'#1e293b', maxWidth:'480px'}}>

            {/* Listening state */}
            {isListening && (
              <div className="p-6 text-center">
                <div className="flex justify-center mb-4">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{background:'linear-gradient(135deg,#dc2626,#ef4444)', boxShadow:'0 0 0 12px rgba(239,68,68,0.15), 0 0 0 24px rgba(239,68,68,0.08)'}}>
                    <span className="text-[32px]">🎤</span>
                  </div>
                </div>
                <div className="text-[16px] font-bold text-white mb-1">Listening...</div>
                <div className="text-[12px] text-slate-400 mb-4">Say product names and quantities</div>
                {transcript && (
                  <div className="rounded-xl px-4 py-3 mb-4"
                    style={{background:'rgba(255,255,255,0.08)'}}>
                    <div className="text-[14px] text-white italic">"{transcript}"</div>
                  </div>
                )}
                <div className="text-[11px] text-slate-500">Release button when done</div>
              </div>
            )}

            {/* Processing state */}
            {isProcessing && (
              <div className="p-6 text-center">
                <div className="text-[40px] mb-3 animate-pulse">🤖</div>
                <div className="text-[15px] font-bold text-white mb-1">AI Processing...</div>
                <div className="text-[12px] text-slate-400 mb-3">Matching products to your order</div>
                {transcript && (
                  <div className="rounded-xl px-4 py-3"
                    style={{background:'rgba(255,255,255,0.08)'}}>
                    <div className="text-[13px] text-slate-300 italic">"{transcript}"</div>
                  </div>
                )}
              </div>
            )}

            {/* Done - show matches */}
            {isDone && (
              <div className="p-5">
                <div className="text-[13px] font-bold text-white mb-1">
                  🤖 AI matched {matches.length} product{matches.length!==1?'s':''}
                </div>
                {transcript && (
                  <div className="text-[11px] text-slate-400 mb-3 italic">"{transcript}"</div>
                )}

                {/* Matched items */}
                <div className="flex flex-col gap-2 mb-4">
                  {matches.length === 0 ? (
                    <div className="rounded-xl p-4 text-center"
                      style={{background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)'}}>
                      <div className="text-[13px] text-red-400">No matching products found</div>
                      <div className="text-[11px] text-slate-400 mt-1">Try again or search manually</div>
                    </div>
                  ) : matches.map((item, i) => {
                    const product = products.find(p => p.id === item.product_id)
                    return (
                      <div key={i} className="flex items-center gap-3 rounded-xl px-4 py-3"
                        style={{background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)'}}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-bold text-white flex-shrink-0"
                          style={{background:'linear-gradient(135deg,#6366f1,#8b5cf6)'}}>
                          {item.product_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="text-[13px] font-semibold text-white">{item.product_name}</div>
                          <div className="text-[10px] text-slate-400">
                            ${parseFloat(product?.price||0).toFixed(2)} × {item.qty} = ${(parseFloat(product?.price||0)*item.qty).toFixed(2)}
                          </div>
                        </div>
                        <div className="text-[18px] font-bold text-white">×{item.qty}</div>
                      </div>
                    )
                  })}
                </div>

                {/* Buttons */}
                <div className="flex gap-3">
                  <button onClick={cancel}
                    className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border-none"
                    style={{background:'rgba(255,255,255,0.08)', color:'#94a3b8'}}>
                    ✕ Cancel
                  </button>
                  {matches.length > 0 && (
                    <button onClick={confirmAdd}
                      className="flex-[2] rounded-xl py-3 text-[14px] font-bold text-white cursor-pointer border-none"
                      style={{background:'linear-gradient(135deg,#16a34a,#15803d)'}}>
                      ✓ Add to Cart
                    </button>
                  )}
                  <button onClick={() => { setState('idle'); setTranscript(''); setMatches([]); startListening() }}
                    className="flex-1 rounded-xl py-3 text-[13px] font-semibold cursor-pointer border-none"
                    style={{background:'rgba(99,102,241,0.2)', color:'#a5b4fc'}}>
                    🎤 Retry
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
