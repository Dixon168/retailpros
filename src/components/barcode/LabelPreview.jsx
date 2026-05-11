// src/components/barcode/LabelPreview.jsx
// Reusable label preview — renders a single label as SVG using the template.
// Also exports renderLabelHTML() to build a printable HTML page for one or
// many labels (used by the print button).
import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

const MM_TO_PX = 3.78  // 1mm = ~3.78px at 96dpi

// Pick a sensible default barcode value if product has none
function valueFor(product, format) {
  // QR can hold anything; otherwise prefer UPC > SKU > id
  if (format === 'QR') return product.upc || product.sku || product.id || product.name || '000000000000'
  if (format === 'EAN13' || format === 'EAN8' || format === 'UPC') {
    // Numeric-only formats need a valid numeric string
    const digits = (product.upc || '').replace(/\D/g,'')
    if (format === 'EAN13' && digits.length >= 12) return digits.slice(0, 13).padStart(13, '0')
    if (format === 'EAN8' && digits.length >= 7)  return digits.slice(0, 8).padStart(8, '0')
    if (format === 'UPC' && digits.length >= 11)  return digits.slice(0, 12).padStart(12, '0')
    // Not enough digits — fall back to CODE128 visual via SKU
    return product.upc || product.sku || '0'
  }
  // CODE128 / CODE39 accepts alphanum
  return product.upc || product.sku || product.id || 'NO-CODE'
}


export function LabelPreview({ template, product, storeName, scale = 2 }) {
  const svgRef = useRef(null)
  const widthPx  = template.width_mm  * MM_TO_PX
  const heightPx = template.height_mm * MM_TO_PX

  useEffect(() => {
    if (!template.show_barcode || !svgRef.current) return
    try {
      const value = valueFor(product, template.barcode_format)
      if (template.barcode_format === 'QR') {
        // Simple inline QR via JsBarcode replacement — fall back to a placeholder.
        // (JsBarcode doesn't do QR; for now draw the value text.)
        svgRef.current.innerHTML = ''
        return
      }
      JsBarcode(svgRef.current, value, {
        format: template.barcode_format || 'CODE128',
        width: 1.5,
        height: template.barcode_height_mm * MM_TO_PX,
        displayValue: !!template.show_barcode_text,
        fontSize: 10,
        margin: 0,
      })
    } catch (e) {
      // Invalid value for the picked format — render nothing rather than crash
      console.warn('Barcode render failed:', e.message)
      if (svgRef.current) svgRef.current.innerHTML = ''
    }
  }, [template, product])

  const cardW = widthPx * scale
  const cardH = heightPx * scale

  return (
    <div
      className="bg-white shadow-md mx-auto"
      style={{
        width: `${cardW}px`,
        height: `${cardH}px`,
        border: '1px dashed #cbd5e1',
        padding: `${4 * scale}px`,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        overflow: 'hidden',
        fontFamily: 'Arial, sans-serif',
        color: '#000',
      }}>
      {template.show_store_name && storeName && (
        <div style={{
          fontSize: `${7 * scale}pt`, fontWeight:'bold', textAlign:'center',
          width:'100%', textTransform:'uppercase', letterSpacing:'0.5px',
        }}>{storeName}</div>
      )}
      {template.show_name && (
        <div style={{
          fontSize: `${template.name_size_pt * scale * 0.5}pt`,
          fontWeight:'bold', textAlign:'center', lineHeight:1.1,
          maxHeight:`${cardH * 0.4}px`, overflow:'hidden',
          width:'100%', wordBreak:'break-word',
        }}>{product.name || '—'}</div>
      )}
      {template.show_price && (
        <div style={{
          fontSize:`${template.price_size_pt * scale * 0.5}pt`,
          fontWeight:'bold', textAlign:'center', color:'#000',
        }}>${Number(product.price ?? product.unitPrice ?? 0).toFixed(2)}</div>
      )}
      {template.show_barcode && (
        <svg ref={svgRef} style={{maxWidth:'100%', maxHeight:`${template.barcode_height_mm * MM_TO_PX * scale}px`}}/>
      )}
      {template.show_sku && product.sku && (
        <div style={{
          fontSize:`${template.sku_size_pt * scale * 0.5}pt`,
          fontFamily:'monospace', textAlign:'center',
        }}>{product.sku}</div>
      )}
      {template.show_date && (
        <div style={{
          fontSize:`${6 * scale}pt`, color:'#666', textAlign:'center',
        }}>{new Date().toLocaleDateString()}</div>
      )}
    </div>
  )
}


// Build full printable HTML for N labels of this product (or list).
// Each label is rendered as a fixed-size box; printer-side CSS uses @page.
export function renderLabelHTML({ template, items, storeName }) {
  // items: [{ product, qty }]
  const labels = []
  items.forEach(({ product, qty }) => {
    for (let i = 0; i < qty; i++) labels.push(product)
  })

  const w = template.width_mm
  const h = template.height_mm
  // Build the labels as plain markup; barcode SVG re-rendered on the print
  // page via a JsBarcode CDN import at run time.
  const labelMarkup = labels.map((p, idx) => {
    const safeName  = String(p.name || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
    const safeSku   = String(p.sku || '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
    const value     = valueFor(p, template.barcode_format)
    const safeValue = String(value).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]))
    return `
    <div class="label" data-idx="${idx}">
      ${template.show_store_name && storeName ? `<div class="store">${storeName}</div>` : ''}
      ${template.show_name ? `<div class="name">${safeName}</div>` : ''}
      ${template.show_price ? `<div class="price">$${Number(p.price ?? 0).toFixed(2)}</div>` : ''}
      ${template.show_barcode ? `<svg class="bc" data-value="${safeValue}"></svg>` : ''}
      ${template.show_sku && p.sku ? `<div class="sku">${safeSku}</div>` : ''}
      ${template.show_date ? `<div class="date">${new Date().toLocaleDateString()}</div>` : ''}
    </div>`
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Print Labels</title>
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #000; }
  .label {
    width: ${w}mm; height: ${h}mm;
    page-break-after: always; page-break-inside: avoid;
    padding: 1mm;
    display: flex; flex-direction: column;
    align-items: center; justify-content: space-between;
    overflow: hidden;
  }
  .store { font-size: 7pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; text-align: center; }
  .name { font-size: ${template.name_size_pt}pt; font-weight: bold; text-align: center; line-height: 1.1; max-height: ${h*0.4}mm; overflow: hidden; }
  .price { font-size: ${template.price_size_pt}pt; font-weight: bold; }
  .sku { font-size: ${template.sku_size_pt}pt; font-family: monospace; text-align: center; }
  .date { font-size: 6pt; color: #666; }
  .bc { width: 100%; max-height: ${template.barcode_height_mm}mm; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
${labelMarkup}
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.12.3/dist/JsBarcode.all.min.js"></script>
<script>
  document.querySelectorAll('svg.bc').forEach(svg => {
    try {
      JsBarcode(svg, svg.dataset.value, {
        format: '${template.barcode_format || 'CODE128'}',
        width: 1.5,
        height: ${template.barcode_height_mm * MM_TO_PX},
        displayValue: ${template.show_barcode_text ? 'true' : 'false'},
        fontSize: 10,
        margin: 0,
      });
    } catch(e) {
      console.warn('barcode failed', e.message);
    }
  });
  window.addEventListener('load', () => setTimeout(() => window.print(), 250));
</script>
</body>
</html>`
}


// Open a print window with the rendered labels
export function printLabels({ template, items, storeName }) {
  const html = renderLabelHTML({ template, items, storeName })
  const w = window.open('', '_blank', 'width=600,height=600')
  if (!w) {
    alert('Pop-up blocked. Please allow pop-ups for this site to print labels.')
    return
  }
  w.document.open()
  w.document.write(html)
  w.document.close()
}
