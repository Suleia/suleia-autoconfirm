"""Aggregate-only report renderer. JSON stdin; PNG/PDF base64 stdout; no network."""
import base64, io, json, math, os, sys, textwrap
from datetime import datetime
from xml.sax.saxutils import escape
from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

def safe(value):
    return str(value if value is not None else 'N/D').replace('\x00', '').replace('→', 'a')[:240]

def num(value):
    return 'N/D' if value is None or not isinstance(value, (int, float)) or not math.isfinite(value) else f'{value:,.2f}'.rstrip('0').rstrip('.').replace(',', '_').replace('.', ',').replace('_', '.')

def render(model):
    report = model.get('report') or {}
    orders = model.get('orders') or report.get('orders') or {}
    period = orders.get('period') or report.get('period') or {}
    metric = model.get('metric', 'confirmed')
    title = 'Pedidos por producto' if model['kind'] == 'products' else 'Suleia - informe comercial'
    labels = {'confirmed': 'Pedidos confirmados', 'received': 'Pedidos recibidos', 'units': 'Unidades recibidas'}
    subtitle = safe(period.get('label', orders.get('day', 'Periodo no disponible'))) + ' | Europe/Madrid'
    lines = []
    if period.get('partial'): lines.append('Periodo en curso. Cierre provisional; los datos pueden cambiar.')
    if orders.get('freshness') != 'FRESH': lines.append('Dropea: ultima instantanea disponible; actualizacion no confirmada.')
    if orders.get('coverage') != 'COMPLETE': lines.append('Dropea: informacion parcial o no disponible; no es un total definitivo.')
    lines.append('Observacion Dropea: ' + safe(orders.get('observedAt')))
    lines.append('Fuente: Dropea Public API V2. Estado actual de los pedidos del periodo.')
    products = sorted(orders.get('products') or [], key=lambda p: (-(p.get(metric) or 0), p.get('key', '')))
    if model['kind'] != 'products':
        lines += ['PEDIDOS', 'Recibidos: '+num(orders.get('received'))+' | Confirmados: '+num(orders.get('confirmed')), 'Pendientes: '+num(orders.get('pending'))+' | Cancelados: '+num(orders.get('cancelled'))]
        previous = report.get('previousOrders') or {}
        if previous:
            lines += ['Comparacion: '+safe((previous.get('period') or {}).get('label')), 'Recibidos anteriores: '+num(previous.get('received'))+' | Confirmados anteriores: '+num(previous.get('confirmed')), safe(report.get('comparisonNote'))]
            if previous.get('coverage')!='COMPLETE': lines.append('Comparacion parcial: cobertura anterior no acreditada.')
        meta = report.get('meta') or {}
        totals = meta.get('totals') or {}
        lines += ['META ADS', 'Gasto: '+num(totals.get('spend'))+' EUR | Compras atribuidas: '+num(totals.get('purchases')), 'ROAS global: '+num(totals.get('roas')), 'Observacion Meta: '+safe(meta.get('observedAt'))]
        if meta.get('cache', {}).get('status') == 'STALE' or not meta: lines.append('Meta: informacion desactualizada o no disponible.')
        lines.append('Pedidos Dropea y compras atribuidas Meta no son equivalentes. ROAS no es beneficio.')
        if period.get('rolling'): lines.append('Meta usa dias naturales completos; no corresponde al intervalo movil de Dropea.')
        facts = sorted(meta.get('facts') or [], key=lambda f: (f.get('roasStatus') not in ['VALID','ZERO'], -(f.get('roas') or 0)))
        for f in facts[:10]:
            if f.get('delivery') == 'ACTIVE': lines.append(safe(f.get('name'))+' | ROAS '+num(f.get('roas') if f.get('roasStatus') in ['VALID','ZERO'] else None)+' | '+num(f.get('spend'))+' EUR | Compras '+num(f.get('purchases')))
        lines.append('PRIORIDADES')
        actions = (meta.get('actions') or meta.get('opportunities') or [])[:3]
        lines += [safe(a.get('name'))+': '+safe(a.get('action')) for a in actions] or ['Datos insuficientes para recomendar cambios concluyentes.']
        lines.append('CAMBIOS VERIFICADOS EN EL PERIODO')
        lines += [safe(c.get('campaign'))+': '+num(c.get('before',0)/100)+' -> '+num(c.get('after',0)/100)+' EUR | '+safe(c.get('at')) for c in report.get('changes', [])] or ['No constan cambios verificados en el registro consultado.']
        lines.append('Propuestas pendientes: '+str(len(report.get('pending') or [])))
        if report.get('errors'): lines.append('Fuentes no disponibles: '+', '.join(report['errors']))
    lines += ['PRODUCTOS - '+labels.get(metric,labels['confirmed']), 'Un pedido puede contener varios productos. Las barras no se suman como pedidos unicos.']
    if not orders.get('productCoverage', False): lines.append('Identificacion de productos incompleta; se conserva Producto sin identificar.')
    # Mobile image contains the top ten; PDF includes every product.
    font_path = next((p for p in [os.environ.get('SULEIA_REPORT_FONT',''), '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'C:/Windows/Fonts/arial.ttf'] if p and os.path.isfile(p)), None)
    font = ImageFont.truetype(font_path, 25) if font_path else ImageFont.load_default(size=25)
    heading_font = ImageFont.truetype(font_path, 36) if font_path else ImageFont.load_default(size=36)
    image_lines = lines
    wrapped = [part for line in image_lines for part in textwrap.wrap(line, 66)]
    height = 200+len(wrapped)*34+len(products[:10])*100+100
    image = Image.new('RGB',(1200,height),'#f5f7fb');draw=ImageDraw.Draw(image)
    draw.rectangle((0,0,1200,110),fill='#14243b');draw.text((45,25),title,font=heading_font,fill='white')
    draw.text((45,130),subtitle,font=font,fill='#14243b');y=180
    for line in wrapped: draw.text((45,y),line,font=font,fill='#334155');y+=34
    maximum=max([p.get(metric) or 0 for p in products[:10]]+[1])
    for p in products[:10]:
        value = p.get(metric) if metric!='units' or p.get('unitsComplete') else None
        name=safe(p.get('name'));name=name[:66]+'...' if len(name)>66 else name
        draw.text((45,y+8),name,font=font,fill='#14243b');y+=45
        width=int(930*(value or 0)/maximum)
        draw.rectangle((45,y,45+max(width,1),y+25),fill='#168d87')
        draw.text((1000,y-5),num(value),font=font,fill='#14243b');y+=55
    draw.text((45,y+12),'Top 10 productos' if len(products)>10 else 'Sin productos verificables' if not products else labels.get(metric,''),font=font,fill='#475569')
    png=io.BytesIO();image.save(png,format='PNG')
    pdf=io.BytesIO();styles=getSampleStyleSheet();story=[Paragraph(escape(title),styles['Title']),Paragraph(escape(subtitle),styles['Normal']),Spacer(1,6*mm)]
    for line in lines:story.extend([Paragraph(escape(line),styles['Normal']),Spacer(1,2*mm)])
    for p in products:
        value=p.get(metric) if metric!='units' or p.get('unitsComplete') else None
        story.extend([Paragraph(escape(safe(p.get('name'))+' | '+num(value)),styles['Normal']),Spacer(1,2*mm)])
    def footer(canvas,doc):canvas.setFont('Helvetica',8);canvas.drawString(18*mm,12*mm,'Suleia | Datos observados, sin acciones automaticas | Pagina '+str(doc.page))
    SimpleDocTemplate(pdf,pagesize=(210*mm,297*mm),rightMargin=18*mm,leftMargin=18*mm,topMargin=18*mm,bottomMargin=20*mm).build(story,onFirstPage=footer,onLaterPages=footer)
    return {'png':base64.b64encode(png.getvalue()).decode(),'pdf':base64.b64encode(pdf.getvalue()).decode()}

if __name__=='__main__':
    try:
        model=json.loads(sys.stdin.buffer.read(4*1024*1024));print(json.dumps(render(model)))
    except Exception:
        print('REPORT_RENDER_FAILED',file=sys.stderr);sys.exit(1)
