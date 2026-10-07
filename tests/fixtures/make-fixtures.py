from reportlab.pdfgen import canvas
def elemental(name, qno, items, total, extra_after=None, pages=False, currency=None):
    c = canvas.Canvas(name); c.setFont('Helvetica', 9); y = 800
    def row(cols):
        nonlocal y
        for x,t in cols: c.drawString(x,y,t)
    row([(40,f'ELEMENTAL LED  Quote #: {qno}')]); y-=14
    row([(40,'Job Name: Stress job   Version Date: Oct 2, 2026')]); y-=14
    row([(40,'BILL TO:')]); y-=12; row([(40,'Stress Electric LLC')]); y-=24
    if currency: row([(40,f'All prices in {currency}')]); y-=14
    row([(40,'Line'),(80,'Item'),(330,'Price'),(400,'Qty'),(450,'Final Price')]); y-=16
    n=0
    for ln,sku,price,qty,final,desc in items:
        if y<90:
            c.showPage(); c.setFont('Helvetica',9); y=800
        row([(40,ln),(80,sku)]+([(330,price)] if price else [])+[(400,qty)]+([(450,final)] if final else [])); y-=12
        for d in desc: row([(80,d)]); y-=12
        y-=6
    if extra_after:
        for t in extra_after: row([(380,t)]); y-=12
    row([(380,f'Quote Total: {total}')]); c.save()
def generic(name, rows, total):
    c = canvas.Canvas(name); c.setFont('Helvetica',9); y=800
    c.drawString(40,y,'ACME LIGHTING SUPPLY  Estimate EST-5521'); y-=20
    c.drawString(40,y,'SKU'); c.drawString(160,y,'Description'); c.drawString(380,y,'Qty'); c.drawString(430,y,'Unit'); c.drawString(490,y,'Amount'); y-=16
    for sku,desc,qty,unit,amt in rows:
        c.drawString(40,y,sku); c.drawString(160,y,desc); c.drawString(380,y,qty); c.drawString(430,y,unit); c.drawString(490,y,amt); y-=14
    c.drawString(430,y-8,f'Total: {total}'); c.save()
T='STREAMLITE 200 Dry Location 3000K, 24V, {L}, White 36in Wire (20AWG), IP20'
# 1 boundary + duplicate SKUs + per-foot + wet + 12V + RGBW + 120W + connector + no price
elemental('s1.pdf','T-300001-01',[
 ('1','DI-TAPE-A','$10.00','1','$10.00',[T.format(L='196.8in')]),                       # exactly one roll (16.4ft)
 ('2','DI-TAPE-B','$12.00','1','$12.00',[T.format(L='196.9in')]),                       # just over -> 2 rolls
 ('3','DI-TAPE-C','$30.00','2','$60.00',[T.format(L='5m')]),                             # 2 x 5m = 32.8ft = 2 rolls
 ('4','DI-TAPE-D','$2.50','100','$250.00',['STREAMLITE 200 Dry 3000K 24V tape, priced per foot']),   # qty in feet
 ('5','DI-WET-E','$80.24','2','$160.48',['STREAMLITE 200 Wet Location 3000K, 24V, 100in, IP65']),    # must block
 ('6','DI-12V-F','$20.00','1','$20.00',['STREAMLITE 200 Dry 3000K, 12V, 100in tape']),               # voltage mismatch
 ('7','DI-RGBW-G','$55.00','1','$55.00',['RGBW tape 24V 120in 300 lm/ft']),
 ('8','DI-PSU-120','$190.00','3','$570.00',['24V 120W Electronic non-dimmable LED Driver']),        # undersized -> N/A
 ('9','DI-PSU-60','$60.00','1','$60.00',['24V 60W non-dimmable LED Driver']),
 ('10','DI-PSU-100','$90.00','1','$90.00',['24V 100W non-dimmable LED Driver']),
 ('11','DI-CONN-H','$3.00','10','$30.00',['Tape to wire connector 10mm 2 pin']),
 ('12','DI-NOPRICE',None,'5',None,['24V 60W non-dimmable LED Driver']),
],'$1,317.48')
# 2 freight/discount lines & CAD
elemental('s2.pdf','T-300002-01',[
 ('1','DI-PSU-100','$90.00','2','$180.00',['24V 100W non-dimmable LED Driver']),
],'$195.00',extra_after=['Freight: $25.00','Discount: -$10.00'],currency='CAD')
# 3 multi-page 60 lines
items=[(str(i+1),f'DI-PSU-{i+1:03d}','$90.00','1','$90.00',['24V 100W non-dimmable LED Driver']) for i in range(60)]
elemental('s3.pdf','T-300003-01',items,'$5,400.00')
# 4 generic vendor layout
generic('s4.pdf',[('ACM-STRIP-3K','LED strip light 24V 3000K 200 lm/ft 16.4ft roll','3','$30.00','$90.00'),
 ('ACM-PS-100','24V 100W non-dimmable power supply','2','$95.00','$190.00')],'$280.00')
# 5 unit/extended mismatch
elemental('s5.pdf','T-300005-01',[('1','DI-PSU-100','$90.00','2','$150.00',['24V 100W non-dimmable LED Driver'])],'$150.00')
